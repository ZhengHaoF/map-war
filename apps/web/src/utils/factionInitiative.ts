/** Read-only operational advice. The model decides; the live guard still executes. */
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import type { GameOrder } from './gameOrders'
import { getAttackableTargets } from './campaignPreview'
import { checkLiveOrder } from './gameplayRules'
import { readRelation, isInTruce } from './diplomacy'
import { getCityNeighbours } from './campaignRoutes'
import { getSupplyStatus, isSupplyHub, occupationRemaining } from './supply'
import { economyOutlook } from './economyOutlook'
import { ownershipTimeline } from './ownershipHistory'
import {
  affordableCampaign,
  assessCampaign,
  assessActiveBattle,
  tacticalText,
  setbackAdvice,
} from './tacticalAssessment'

export type InitiativeKind =
  | 'defend'
  | 'recapture'
  | 'assemble'
  | 'attack'
  | 'support'
  | 'restore-supply'
  | 'consolidate'
  | 'hold'
export interface FactionInitiative {
  kind: InitiativeKind
  goal: string
  reason: string
  targetGb?: string
  sourceGb?: string
  examples: GameOrder[]
}
const roundDown = (n: number) => Math.floor(n * 10) / 10

export function buildFactionInitiative(faction: Owner): FactionInitiative {
  const store = useGameStore()
  const cities = store.cities
  const own = Object.values(cities).filter((c) => c.owner === faction)
  const points = store.getActionPoints(faction)
  const name = (gb: string) => cities[gb]?.name ?? gb
  const hostile = (other: Owner) =>
    other !== faction &&
    other !== Owner.NEUTRAL &&
    readRelation(store.relations, faction, other).status === 'war' &&
    !isInTruce(store.relations, faction, other, store.currentDate)
  const outlook = economyOutlook(
    cities,
    faction,
    store.turnCount,
    store.getTreasury(faction),
    store.getGranary(faction),
  )
  const reserve = (troops: number) => Math.max(2, troops * 0.25)
  const legal = (orders: GameOrder[]) =>
    orders
      .filter((order) => checkLiveOrder(order, { authority: 'faction', actor: faction }).ok)
      .slice(0, points)
  const reinforce = (gb: string): GameOrder[] => {
    const target = cities[gb]!
    const donors = own
      .filter((c) => c.gb !== gb && c.troops > reserve(c.troops))
      .map((c) =>
        affordableCampaign(
          c.gb,
          gb,
          roundDown(c.troops - reserve(c.troops)),
          'moveTroops',
          faction,
        ),
      )
      .filter((p) => p.ok)
      .sort((a, b) => (a.route?.costDistanceKm ?? Infinity) - (b.route?.costDistanceKm ?? Infinity))
    return legal([
      ...(donors[0] ? [donors[0].order] : []),
      { order: 'recruit', gb, amount: Math.min(3, outlook.recruitLimit) },
      ...(target.morale < 60
        ? [{ order: 'rally' as const, gb, amount: Math.min(10, 100 - target.morale) }]
        : []),
      { order: 'fortify', gb, amount: Math.min(5, 100 - target.fort) },
    ])
  }
  const front = store.battles.find(
    (b) => b.active && b.attacker === faction && cities[b.from]?.owner === faction,
  )
  const frontAssessment = front ? assessActiveBattle(front) : null
  if (!own.length || points <= 0)
    return {
      kind: 'hold',
      goal: !own.length ? '无领土可经营' : '等待行动点恢复',
      reason: `不凭空生成军队、银粮或行动点；已有战斗仍由系统结算，合法撤退不耗点。${frontAssessment ? tacticalText(frontAssessment) : ''}`,
      examples:
        front &&
        checkLiveOrder(
          { order: 'stopBattle', id: front.id },
          { authority: 'faction', actor: faction },
        ).ok
          ? [{ order: 'stopBattle', id: front.id }]
          : [],
    }

  const incoming = store.battles
    .filter((b) => b.active && b.defender === faction && cities[b.to]?.owner === faction)
    .sort(
      (a, b) =>
        (cities[b.from]?.fieldForce ?? 0) / Math.max(1, cities[b.to]!.troops) -
        (cities[a.from]?.fieldForce ?? 0) / Math.max(1, cities[a.to]!.troops),
    )
  if (incoming[0]) {
    const gb = incoming[0].to
    const enemyAssessment = assessActiveBattle(incoming[0])
    return {
      kind: 'defend',
      goal: `保住${name(gb)}`,
      targetGb: gb,
      reason: `本城正在遭受进攻，优先调兵增援、适量征兵、筑防或整军，而非在远离前线的城市例行建设。${enemyAssessment ? `以下为敌方进攻视角，攻损属于敌方：${tacticalText(enemyAssessment)}` : ''}若无法守住，应说明取舍。`,
      examples: reinforce(gb),
    }
  }
  if (front)
    return {
      kind: 'support',
      goal: `支援${front.fromName}至${front.toName}战线`,
      sourceGb: front.from,
      targetGb: front.to,
      reason: `已有战线，不重复从同一城开战。${frontAssessment ? tacticalText(frontAssessment) : ''}可比较支援、整军与撤退；现有战线行军费不重复收取。`,
      examples: [
        ...reinforce(front.from),
        ...(checkLiveOrder(
          { order: 'stopBattle', id: front.id },
          { authority: 'faction', actor: faction },
        ).ok
          ? [{ order: 'stopBattle' as const, id: front.id }]
          : []),
      ],
    }

  const unsupplied = own.find(
    (c) =>
      getCityNeighbours(c.gb).some((gb) => cities[gb] && hostile(cities[gb]!.owner)) &&
      !getSupplyStatus(c.gb, faction, cities, store.turnCount).supplied,
  )
  if (unsupplied)
    return {
      kind: 'restore-supply',
      goal: `恢复${name(unsupplied.gb)}补给`,
      targetGb: unsupplied.gb,
      reason:
        '前线未连通己方已整合补给中心。优先守住连接、整合补给城或合法集结；断供进攻仍合法，但战力降低，不能凭空恢复补给。',
      examples: reinforce(unsupplied.gb),
    }

  const lost = new Map<string, number>()
  for (const { event, targetOwner, turn } of ownershipTimeline(store.eventLog)) {
    if (event.type !== 'capture') continue
    if (targetOwner === faction && event.actor !== faction) lost.set(event.targetGb, turn)
    if (event.actor === faction) lost.delete(event.targetGb)
  }
  const recentLoss = new Set(
    [...lost]
      .filter(
        ([gb, turn]) => store.turnCount - turn <= 6 && cities[gb] && hostile(cities[gb]!.owner),
      )
      .map(([gb]) => gb),
  )
  const candidates = own
    .filter((c) => c.troops > 0 || c.fieldForce > 0)
    .flatMap((c) =>
      getAttackableTargets(c.gb, c.fieldForce > 0 ? 0 : Math.min(1, c.troops), faction).filter(
        (p) => hostile(cities[p.targetGb]!.owner),
      ),
    )
  candidates.sort((a, b) => {
    const value = (p: typeof a) =>
      (recentLoss.has(p.targetGb) ? 1000 : 0) +
      (isSupplyHub(cities[p.targetGb]!, store.turnCount) ? 20 : 0) +
      cities[p.targetGb]!.cityLevel * 5 +
      ((cities[p.order.from!]!.troops + cities[p.order.from!]!.fieldForce) /
        Math.max(1, cities[p.targetGb]!.troops)) *
        10 -
      (p.route?.costDistanceKm ?? 0) / 100
    return (
      value(b) - value(a) ||
      a.targetGb.localeCompare(b.targetGb) ||
      a.order.from!.localeCompare(b.order.from!)
    )
  })
  const option = candidates[0]
  const pending = own.find((c) => occupationRemaining(c, store.turnCount) > 0)
  if (pending && (!option || !recentLoss.has(option.targetGb)))
    return {
      kind: 'consolidate',
      goal: `稳固${name(pending.gb)}`,
      targetGb: pending.gb,
      reason: '新占领城市尚在整合期，优先保护补给连接与驻军，不为了产生动作而不断开启新战线。',
      examples: reinforce(pending.gb),
    }
  if (option) {
    const source = cities[option.order.from!]!
    const target = cities[option.targetGb]!
    const amount = roundDown(Math.max(0, source.troops - reserve(source.troops)))
    const attack = affordableCampaign(source.gb, target.gb, amount, 'battle', faction)
    const assessment = assessCampaign(attack)
    const ready =
      attack.ok &&
      attack.supply?.supplied &&
      (attack.fightingTroops ?? 0) >= Math.max(2, target.troops * 1.2) &&
      assessment?.risk === 'favorable'
    const reclaim = recentLoss.has(target.gb)
    return {
      kind: ready ? (reclaim ? 'recapture' : 'attack') : 'assemble',
      goal: `${ready ? (reclaim ? '收复' : '进攻') : '集结准备争夺'}${name(target.gb)}`,
      sourceGb: source.gb,
      targetGb: target.gb,
      reason: `${reclaim ? '近期失地，已保留易主事实。' : `与${OWNER_LABELS[target.owner]}交战，目标是可达的敌方节点。`}来源${name(source.gb)}，守军${target.troops}k/工事${target.fort}/士气${target.morale}；建议至少留守${roundDown(reserve(source.troops))}k。${assessment ? tacticalText(assessment) : `当前进攻不可执行：${attack.reason ?? '需重新查询'}。`}${ready ? '可比较进攻与继续整备；兵力阈值只是粗略建议，不是胜率或胜利保证。' : '当前建议先集结与整备，不把1k路线示例当成足够的攻城兵力。'}`,
      examples: ready ? [attack.order] : reinforce(source.gb),
    }
  }
  return {
    kind: 'hold',
    goal: '稳住现有局势',
    reason:
      '目前未找到对交战势力可执行的进攻候选，或受到兵力、预算、路线、同盟及停战限制。不要为制造反击而对无关和平势力开战；可以内政或等待。',
    examples: [],
  }
}

export function buildInitiativeContext(faction: Owner): string {
  const store = useGameStore()
  const intent = buildFactionInitiative(faction)
  const refusals = store.eventLog
    .filter((e) => e.type === 'commandReceipt' && e.faction === faction && !e.ok)
    .slice(-2)
  return [
    `本回合主动目标：${intent.goal}（${intent.kind}）。${intent.reason}`,
    '这是公开局势推导的建议，不是强制指令、额外权限或自动执行；先处理前线压力，再考虑远方例行建设。合法等待仍允许，但有威胁时应在msg中解释原因。',
    ...(intent.examples.length
      ? [
          `分别可执行的行动例子（不是整批预批，须按顺序重算预算）：${JSON.stringify(intent.examples)}`,
        ]
      : []),
    ...refusals.map((e) =>
      e.type === 'commandReceipt'
        ? `近期未执行：${e.label}，原因${e.reason ?? '未完成'}。${setbackAdvice(e.reason ?? '')}这是历史反馈，当前预算以上方现状为准，不原样重复失败计划。`
        : '',
    ),
  ].join('\n')
}
