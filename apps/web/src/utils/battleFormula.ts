/**
 * 战斗基础公式 + AI 调味钳制 + 士气崩溃判定。
 *
 * 纯函数模块，无 Vue / Pinia 依赖，可单测。
 *
 * 架构（用户拍板 2026-07-28）：
 * - 本地公式 = 减员主干（确定性，士气是参数）
 * - AI 调味 = 突发减员 + 士气事件（低频率，戏剧性）
 * - AI 失败 → 纯 base 走人，不阻塞
 */

// ─── 配置 ───

import { BATTLE as BATTLE_RULES } from '@/data/gameConfig'
import { FORT_CURVE_SEED } from '@/data/gameConfig'

// 向后兼容：保留 BATTLE_RULES 导出（供给测试/调试脚本）
export { BATTLE_RULES }

// ─── 类型 ───

export interface BattleInput {
  atkForce: number
  defTroops: number
  atkMorale: number
  defMorale: number
  fort: number
  terrain?: string
  /** 远征战力衰减系数 [0.4, 1.0]，默认 1.0（无衰减） */
  distanceFactor?: number
}

export interface BaseResult {
  attackerLoss: number
  defenderLoss: number
  atkMoraleDelta: number
  defMoraleDelta: number
}

export interface FlavorEvent {
  type: 'shock' | 'morale'
  side: 'attacker' | 'defender'
  magnitude?: number
  delta?: number
  narrative?: string
}

export interface FlavorResult {
  events: FlavorEvent[]
  narrative?: string
}

export type CollapseSide = 'attacker' | 'defender' | null

// ─── 基础公式 ───

function moraleFactor(morale: number): number {
  const r = BATTLE_RULES
  const raw = 1 + (r.moraleRef - morale) / 100
  return Math.min(r.moraleFactorCeil, Math.max(r.moraleFactorFloor, raw))
}

function moraleDeltaFromLoss(lossRate: number): number {
  const steps = (Math.max(0, lossRate) * 100) / 10
  return -Math.round(steps * BATTLE_RULES.moraleDamagePer10pct)
}

export function computeBaseBattle(input: BattleInput): BaseResult {
  const r = BATTLE_RULES
  const df = input.distanceFactor ?? 1.0
  const effectiveAtk = input.atkForce * df
  const ratio = Math.min(
    r.ratioClamp[1],
    Math.max(r.ratioClamp[0], effectiveAtk / Math.max(input.defTroops, 1)),
  )
  // 工事收益曲线（防“刷数字”）：种子基准（FORT_CURVE_SEED=20）以下保持线性（与旧公式一致），
  // 之上改 sqrt 凹曲线——堆高边际收益递减（fort 25 线性 1.25 → 曲线 1.5；fort 100 仍 2.0）。
  const rawF =
    input.fort <= FORT_CURVE_SEED
      ? input.fort / 100
      : FORT_CURVE_SEED / 100 +
        (1 - FORT_CURVE_SEED / 100) * Math.sqrt((input.fort - FORT_CURVE_SEED) / (100 - FORT_CURVE_SEED))
  const fortF = 1 + rawF * (r.fortMaxFactor - 1)
  // terrain 键大小写归一：store/seed 存大写（MOUNTAIN/HILL/PLAIN/FOREST），config 键为小写
  const terrainF = r.terrainFactor[(input.terrain ?? 'plain').toLowerCase()] ?? 1.0

  const atkLossRate = r.baseRate * terrainF * moraleFactor(input.atkMorale)
  const defLossRate = r.baseRate * ratio / fortF * moraleFactor(input.defMorale)

  const attackerLoss = Math.max(1, Math.round(input.atkForce * atkLossRate))
  const defenderLoss = Math.max(1, Math.round(input.defTroops * defLossRate))

  return {
    attackerLoss,
    defenderLoss,
    atkMoraleDelta: moraleDeltaFromLoss(attackerLoss / Math.max(input.atkForce, 1)),
    defMoraleDelta: moraleDeltaFromLoss(defenderLoss / Math.max(input.defTroops, 1)),
  }
}

// ─── 士气崩溃判定（确定性伪随机，replay 安全）───

function seededChance(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

function collapseRate(morale: number): number {
  const c = BATTLE_RULES.collapse
  if (morale > c.threshold) return 0
  const t = 1 - morale / c.threshold
  return Math.min(1, c.baseRate + t * (1 - c.baseRate))
}

export function checkMoraleCollapse(args: {
  battleId: string
  turns: number
  atkMorale: number
  defMorale: number
}): CollapseSide {
  const c = BATTLE_RULES.collapse
  if (!c.enabled) return null

  // 守方优先判定（攻城方天然吃亏）
  for (const [side, morale, salt] of [
    ['defender', args.defMorale, 'def'],
    ['attacker', args.atkMorale, 'atk'],
  ] as const) {
    const rate = collapseRate(morale)
    if (rate > 0 && seededChance(`${args.battleId}|${args.turns}|${salt}`) < rate) {
      return side
    }
  }
  return null
}

// ─── AI 调味钳制（无配额，只封顶单条 magnitude / delta）───

export function clampFlavor(flavor: FlavorResult, base: BaseResult): FlavorResult {
  const cap = BATTLE_RULES.flavor
  const events = (flavor.events ?? [])
    .filter((e) => e.type === 'shock' || e.type === 'morale')
    .map((e) => {
      if (e.type === 'shock') {
        const baseLoss = e.side === 'attacker' ? base.attackerLoss : base.defenderLoss
        const clamped = Math.min(
          Math.max(0, Math.round(e.magnitude ?? 0)),
          Math.round(baseLoss * cap.shockCap),
        )
        return { ...e, magnitude: clamped }
      }
      const clamped = Math.min(
        cap.moraleCap,
        Math.max(-cap.moraleCap, Math.round(e.delta ?? 0)),
      )
      return { ...e, delta: clamped }
    })
    .filter((e) =>
      e.type === 'shock' ? (e.magnitude ?? 0) > 0 : (e.delta ?? 0) !== 0,
    )

  return { events, narrative: flavor.narrative }
}
