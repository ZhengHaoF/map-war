/**
 * 事件日志 → 中文展示文案（纯函数，EventLogPanel 与 TurnSummaryModal 共享）。
 *
 * 约定：
 * - describeEvent 接受 `cities` 查询方法而非 store 引用，保持无副作用、可测试。
 * - round1 仅供 treasuryChange/granaryChange/economicTick 三种含浮点 delta 的事件使用，
 *   其余事件类型均为整数类型（兵力/士气/工事等），不需要。
 */

import type { GameEvent, CityStatField, BattleEndReason } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { round1 } from '@/utils/format'

// ─── 势力 / 城市查询 ───

/** 势力名（中文），OWNER_LABELS 仅含游戏中的势力，故做安全 fallback */
export function factionName(o: Owner): string {
  return (OWNER_LABELS as Record<string, string>)[o] ?? o
}

/** 城市名（中文），从外部传入的城市映射表中查询 */
export function cityName(gb: string, cities: Record<string, { name: string }>): string {
  return cities[gb]?.name ?? gb
}

// ─── 徽章 ───

/** 事件类型 → 两字徽章标签 */
export function eventBadge(e: GameEvent): string {
  const map: Record<GameEvent['type'], string> = {
    capture: '占领',
    attack: '进攻',
    deploy: '出兵',
    moraleChange: '士气',
    cityStatChange: '建设',
    produce: '征兵',
    moveTroops: '调兵',
    dateAdvance: '日期',
    setFactionAlive: '存亡',
    battleStart: '开战',
    battleEnd: '停战',
    selectFaction: '择势',
    narrative: '叙事',
    treasuryChange: '银库',
    granaryChange: '粮仓',
    economicTick: '经济',
    relationChange: '外交',
  }
  return map[e.type]
}

// ─── 事件 → 一行中文文本 ───

const FIELD_LABELS: Record<CityStatField, string> = {
  industry: '工业',
  food: '粮食',
  fort: '工事',
  cityLevel: '城市等级',
}

/**
 * 将单条 GameEvent 转为一行可读中文。
 *
 * @param e       事件对象
 * @param cities  城市映射（gb → { name }），从 store.cities 构建或直接传递
 * @returns       一行文本，不含徽章前缀
 */
export function describeEvent(e: GameEvent, cities: Record<string, { name: string }>): string {
  const cn = (gb: string) => cityName(gb, cities)
  const fn = factionName

  switch (e.type) {
    case 'capture':
      return `${cn(e.targetGb)} → ${fn(e.actor)}${e.resultTroops != null ? ` (驻军 ${e.resultTroops}k)` : ''}`
    case 'attack': {
      const base = `${cn(e.fromGb)} ⇢ ${cn(e.targetGb)} 攻损 ${e.attackerLoss}k / 守损 ${e.defenderLoss}k`
      return e.narrative ? `${base} ${e.narrative}` : base
    }
    case 'deploy':
      return `${cn(e.fromGb)} 出兵 ${e.amount}k`
    case 'moraleChange':
      return `${cn(e.targetGb)} 士气 ${e.delta > 0 ? '+' : ''}${e.delta}`
    case 'cityStatChange':
      return `${cn(e.targetGb)} ${FIELD_LABELS[e.field]} ${e.delta > 0 ? '+' : ''}${e.delta}`
    case 'produce':
      return `${cn(e.targetGb)} 征兵 +${e.amount}k`
    case 'moveTroops':
      return `${cn(e.fromGb)} ⇢ ${cn(e.toGb)} 调兵 ${e.amount}k`
    case 'dateAdvance':
      return `📅 日期推进至 ${e.date}`
    case 'setFactionAlive':
      return e.alive ? `${fn(e.faction)} 参战` : `${fn(e.faction)} 覆灭`
    case 'battleStart':
      return `${e.fromName} ⚔ ${e.toName}`
    case 'battleEnd': {
      const reasonLabels: Record<BattleEndReason, string> = {
        capture: '被占领',
        attackerRouted: '攻方溃散',
        retreat: '撤退',
        defenderCollapse: '守方崩溃',
        attackerCollapse: '攻方崩溃',
        peace: '停战',
      }
      const label = e.reason ? reasonLabels[e.reason] : '战斗结束'
      return e.reason === 'retreat' && e.retreatLoss != null ? `${label}（追击 ${e.retreatLoss}k）` : label
    }
    case 'selectFaction':
      return `${e.playerName || '主公'} 择 ${fn(e.faction)}`
    case 'narrative':
      if (e.kind === 'settlement') {
        // 世界 AI 结算叙事通常较长，摘要时截断，日志面板保留全文
        return e.playerInput ? `${e.playerInput} ← ${e.aiMessage}` : e.aiMessage
      }
      return `${e.playerInput} ← ${e.aiMessage}`
    case 'treasuryChange':
      return `${fn(e.faction)} 银库 ${e.delta > 0 ? '+' : ''}${round1(e.delta)} 万银${e.reason ? `（${e.reason}）` : ''}`
    case 'granaryChange':
      return `${fn(e.faction)} 粮仓 ${e.delta > 0 ? '+' : ''}${round1(e.delta)} 万石${e.reason ? `（${e.reason}）` : ''}`
    case 'economicTick': {
      const parts = e.entries.map((it) => `${fn(it.faction)}${it.silverDelta >= 0 ? '+' : ''}${round1(it.silverDelta)}`)
      return `经济结算：${parts.join('，')}`
    }
    case 'relationChange': {
      const verb = e.status === 'war' ? '宣战' : e.status === 'alliance' ? '结盟' : '停战'
      return `${fn(e.a)} ⇄ ${fn(e.b)} ${verb}${e.note ? `（${e.note}）` : ''}`
    }
  }
  return ''
}

// ─── 摘要辅助 ───

/** 事件是否属于"回合例行事务"（不构成值得展示的摘要内容） */
export function isRoutineEvent(e: GameEvent): boolean {
  return e.type === 'narrative' || e.type === 'dateAdvance'
}

/** 事件是否属于"重要"事件（应在摘要中高亮） */
export function isImportantEvent(e: GameEvent): boolean {
  return (
    e.type === 'setFactionAlive' ||
    e.type === 'capture' ||
    (e.type === 'relationChange' && e.status === 'war') ||
    e.type === 'battleStart' ||
    (e.type === 'battleEnd' && e.reason === 'capture')
  )
}

/** 摘要用的事件分类键（用于分组展示） */
export type SummaryGroup = '军事' | '外交' | '经济' | '内政' | '大势'

export function eventSummaryGroup(e: GameEvent): SummaryGroup {
  switch (e.type) {
    case 'capture':
    case 'attack':
    case 'deploy':
    case 'battleStart':
    case 'battleEnd':
      return '军事'
    case 'relationChange':
      return '外交'
    case 'treasuryChange':
    case 'granaryChange':
    case 'economicTick':
      return '经济'
    case 'produce':
    case 'moveTroops':
    case 'moraleChange':
    case 'cityStatChange':
      return '内政'
    default:
      return '大势'
  }
}

/** 分组顺序 */
export const SUMMARY_GROUP_ORDER: SummaryGroup[] = ['军事', '外交', '经济', '内政', '大势']
