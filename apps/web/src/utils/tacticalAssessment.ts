/** Read-only, one-settlement comparison. Never a win probability or executor. */
import { useGameStore, type BattleInfo } from '@/stores/game'
import { Owner } from '@/data/owners'
import { BATTLE, BATTLE_MIN_ATTRITION_PER_ROUND } from '@/data/gameConfig'
import { computeBaseBattle, type BattleInput } from './battleFormula'
import { expeditionFactor } from './economy'
import { distanceBetween } from './locationResolver'
import { getSupplyStatus } from './supply'
import { previewCampaign, type CampaignPreview } from './campaignPreview'

export interface TacticalAssessment {
  risk: 'high' | 'consider' | 'favorable'
  label: string
  attackerLoss: number
  defenderLoss: number
  attackerMoraleAfter: number
  defenderMoraleAfter: number
  remainingGarrison: number
  silver: number
  food: number
  reasons: string[]
}
export function compareBattle(
  input: BattleInput & {
    remainingGarrison: number
    supplied: boolean
    silver: number
    food: number
  },
): TacticalAssessment {
  const base = computeBaseBattle(input)
  const empty = input.defTroops <= 0 // Scheduler captures empty targets before applying losses.
  const attackerLoss = empty
    ? 0
    : Math.min(input.atkForce, Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.attackerLoss))
  const defenderLoss = empty
    ? 0
    : Math.min(input.defTroops, Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.defenderLoss))
  const attackerMoraleAfter = Math.max(
    0,
    Math.min(100, input.atkMorale + (empty ? 0 : base.atkMoraleDelta)),
  )
  const defenderMoraleAfter = Math.max(
    0,
    Math.min(100, input.defMorale + (empty ? 0 : base.defMoraleDelta)),
  )
  const attackerRate = attackerLoss / Math.max(0.1, input.atkForce)
  const defenderRate = defenderLoss / Math.max(0.1, input.defTroops)
  const reasons: string[] = []
  const collapse = BATTLE.collapse.enabled && attackerMoraleAfter <= BATTLE.collapse.threshold
  if (collapse) reasons.push('攻方士气已进入或预计进入崩溃判定区间，不代表必然崩溃')
  if (attackerRate >= 0.25) reasons.push('单轮基础攻损达到参战兵力的四分之一或更多')
  if (input.remainingGarrison < 2) reasons.push('来源留守不足2k，后方防守较薄弱')
  if (!input.supplied) reasons.push('断供削弱进攻战力，应比较恢复连接与继续进攻')
  if (!empty && defenderRate <= attackerRate)
    reasons.push('基础比例消耗并未明显有利于攻方，城防与地形可能拖长战线')
  if (empty) reasons.push('目标当前无驻军，占领仍由正常系统结算')
  const risk =
    collapse || attackerRate >= 0.25
      ? 'high'
      : input.remainingGarrison < 2 ||
          !input.supplied ||
          (!empty && defenderRate < attackerRate * 1.2)
        ? 'consider'
        : 'favorable'
  if (!reasons.length) reasons.push('当前基础比例消耗相对有利，但敌方增援或士气变化可能逆转局面')
  return {
    risk,
    label: risk === 'high' ? '风险较高' : risk === 'consider' ? '需要权衡' : '相对有利',
    attackerLoss,
    defenderLoss,
    attackerMoraleAfter,
    defenderMoraleAfter,
    remainingGarrison: Math.round(input.remainingGarrison * 10) / 10,
    silver: input.silver,
    food: input.food,
    reasons,
  }
}
export function assessCampaign(preview: CampaignPreview): TacticalAssessment | null {
  if (!preview.ok || preview.order.order !== 'battle' || !preview.route) return null
  const store = useGameStore()
  const from = store.cities[preview.order.from!],
    to = store.cities[preview.targetGb]
  if (!from || !to || !Number.isFinite(preview.fightingTroops) || preview.fightingTroops! <= 0)
    return null
  return compareBattle({
    atkForce: preview.fightingTroops!,
    defTroops: to.troops,
    atkMorale: from.morale,
    defMorale: to.morale,
    fort: to.fort,
    terrain: to.terrain,
    distanceFactor:
      expeditionFactor(preview.route.costDistanceKm) * (preview.supply?.battleFactor ?? 1),
    remainingGarrison: from.troops - (preview.order.deployAmount ?? 0),
    supplied: preview.supply?.supplied ?? true,
    silver: preview.silver ?? 0,
    food: preview.food ?? 0,
  })
}
export function assessActiveBattle(battle: BattleInfo): TacticalAssessment | null {
  const store = useGameStore(),
    from = store.cities[battle.from],
    to = store.cities[battle.to]
  if (
    !battle.active ||
    !from ||
    !to ||
    from.owner !== battle.attacker ||
    to.owner !== battle.defender ||
    from.fieldForce <= 0
  )
    return null
  const supply =
    battle.supplyRulesVersion === 1
      ? getSupplyStatus(battle.from, battle.attacker, store.cities, store.turnCount)
      : undefined
  const distance = battle.marchDistanceKm ?? distanceBetween(battle.from, battle.to)
  return compareBattle({
    atkForce: from.fieldForce,
    defTroops: to.troops,
    atkMorale: from.morale,
    defMorale: to.morale,
    fort: to.fort,
    terrain: to.terrain,
    distanceFactor:
      (distance === null ? 1 : expeditionFactor(distance)) * (supply?.battleFactor ?? 1),
    remainingGarrison: from.troops,
    supplied: supply?.supplied ?? true,
    silver: 0,
    food: 0,
  }) // Existing march fee is sunk, not charged again per round.
}
export function tacticalText(value: TacticalAssessment): string {
  return `${value.label}：下一次结算基础估计攻损${value.attackerLoss}k/守损${value.defenderLoss}k，攻方士气${value.attackerMoraleAfter}/守方士气${value.defenderMoraleAfter}，来源留守${value.remainingGarrison}k；本次行军银${value.silver}/粮${value.food}。${value.reasons.join('；')}。这是静态基础比较，不含双方后续动作、经济减员、突发事件及崩溃结果，不是胜率或胜利保证。`
}
export function affordableCampaign(
  from: string,
  to: string,
  maximum: number,
  kind: 'battle' | 'moveTroops',
  actor: Owner,
): CampaignPreview {
  const full = previewCampaign(from, to, maximum, kind, actor)
  if (full.ok || !Number.isFinite(maximum) || maximum <= 0 || !full.reason?.includes('银粮不足'))
    return full
  let low = kind === 'battle' && (useGameStore().cities[from]?.fieldForce ?? 0) > 0 ? 0 : 1
  let high = Math.floor(maximum * 10),
    best: CampaignPreview | undefined
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = previewCampaign(from, to, mid / 10, kind, actor)
    if (candidate.ok) {
      best = candidate
      low = mid + 1
    } else high = mid - 1
  }
  return best ?? full
}
export function setbackAdvice(reason: string): string {
  if (/gb|拼写|结构预检/.test(reason))
    return '修正指令名和必填字段；内政目标使用gb，不以缩量替代结构修正。'
  if (/银粮|预算|资金/.test(reason))
    return '用当前银粮重算整批费用，可减少兵力或行动数量；缩量仍须正常路线与外交检查。'
  if (/行动点/.test(reason)) return '减少付费动作或等待行动点恢复；自己的活动战线仍可合法撤退。'
  if (/停战|同盟|宣战/.test(reason)) return '改为合法内政或等待，不为制造反击绕过外交限制。'
  if (/路线|连接|己方城市|第三方/.test(reason))
    return '重新选择合法来源与目标；减少兵力不能修复无连接或穿越第三方。'
  return '依据当前世界状态调整计划，不把历史失败当作系统已执行。'
}
