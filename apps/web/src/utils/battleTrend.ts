/**
 * 战斗状态推导工具：趋势判定、兵力比条、战果摘要文案。
 *
 * 从 LeafletMap（上回合口径）和 aiPromptBuilder（累计口径）抽出，
 * 两处消费者 + PlayerStatusPanel 共用，避免阈值漂移。
 *
 * 纯函数，不 import store，入参全部由调用方传入。
 */

import { BATTLE_TREND_THRESHOLD } from '@/data/gameConfig'

// ── 前景最小类型：只取 BattleInfo 里的子集，避免循环依赖 ──

interface BattleLoss {
  turns: number
  totalAttackerLoss: number
  totalDefenderLoss: number
  lastAttackerLoss: number
  lastDefenderLoss: number
}

// ── 趋势判定 ──

export type TrendBasis = 'lastTurn' | 'total'
export type TrendClass = 'trend-atk' | 'trend-def' | 'trend-even'

export interface TrendResult {
  label: string
  cls: TrendClass
}

/**
 * 战斗趋势判定。
 *
 * 两种口径的不等式方向不同（判定谁亏得更多 vs 谁亏得更少），
 * 用独立分支保持各处原有公式精确不变，只做集中 + 共享类型。
 *
 * basis='lastTurn'：按上回合损耗，a < d*0.7 → 攻方占优（LeafletMap 原口径）
 * basis='total'：按累计损耗，a > d*1.2 → 守方占优（aiPromptBuilder 原口径）
 */
export function battleTrend(b: BattleLoss, basis: TrendBasis = 'lastTurn'): TrendResult {
  if (b.turns <= 0) return { label: '初次交锋', cls: 'trend-even' }

  if (basis === 'lastTurn') {
    const a = b.lastAttackerLoss
    const d = b.lastDefenderLoss
    if (a < d * 0.7) return { label: '▲ 攻方占优', cls: 'trend-atk' }
    if (d < a * 0.7) return { label: '▼ 守方占优', cls: 'trend-def' }
    return { label: '— 僵持', cls: 'trend-even' }
  }

  // total：与 aiPromptBuilder 口径一致（a > d*threshold → 攻方亏多 → 守方占优）
  const a = b.totalAttackerLoss
  const d = b.totalDefenderLoss
  if (a > d * BATTLE_TREND_THRESHOLD) return { label: '▼ 守方占优', cls: 'trend-def' }
  if (d > a * BATTLE_TREND_THRESHOLD) return { label: '▲ 攻方占优', cls: 'trend-atk' }
  return { label: '— 僵持', cls: 'trend-even' }
}

// ── 兵力比 ──

/**
 * 攻方野战兵力占双方合计的百分比，钳制到 4~96（防 0/100 极端）。
 * 与 LeafletMap 现有 forceShare 口径一致。
 */
export function battleForceShare(atk: number, def: number): number {
  const total = atk + def
  if (total <= 0) return 50
  return Math.min(96, Math.max(4, Math.round((atk / total) * 100)))
}

// ── 战果摘要文案 ──

/**
 * 生成一段简洁的战果摘要文案，供 battleEnd toast 复用。
 * 如：「攻损 2.4k / 守损 5.1k · 共 3 回合」
 */
export function battleSummaryText(b: BattleLoss): string {
  return `攻损 ${b.totalAttackerLoss}k / 守损 ${b.totalDefenderLoss}k · 共 ${b.turns} 回合`
}
