/** UI and AI recommendations share the actual execution guard, not a parallel ruleset. */
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import type { GameOrder } from './gameOrders'
import { checkLiveOrder } from './gameplayRules'
import { routesFrom, type CampaignRoute } from './campaignRoutes'
import { marchCost } from './economy'
import { CAMPAIGN_AI_TARGET_LIMIT } from '@/data/gameConfig'
import { getDisplayName } from '@/data/displayNames'

export interface CampaignPreview {
  order: GameOrder
  ok: boolean
  reason?: string
  targetGb: string
  route?: CampaignRoute
  silver?: number
  food?: number
  fightingTroops?: number
}
export function previewCampaign(
  from: string,
  to: string,
  amount: number,
  kind: 'battle' | 'moveTroops' = 'battle',
  actor?: Owner,
): CampaignPreview {
  const store = useGameStore()
  const faction = actor ?? store.currentFaction
  const useDeployed = kind === 'battle' && amount === 0 && (store.cities[from]?.fieldForce ?? 0) > 0
  const order: GameOrder =
    kind === 'battle'
      ? { order: 'battle', from, to, ...(useDeployed ? {} : { deployAmount: amount }) }
      : { order: 'moveTroops', from, to, amount }
  const check = checkLiveOrder(order, { actor: faction ?? undefined })
  const route = faction ? routesFrom(from, faction, store.cities).get(to) : undefined
  const fightingTroops = kind === 'battle' ? amount + (store.cities[from]?.fieldForce ?? 0) : amount
  const cost =
    route && Number.isFinite(amount) && (amount > 0 || useDeployed)
      ? marchCost(route.costDistanceKm, fightingTroops)
      : undefined
  return { order, ok: check.ok, reason: check.reason, targetGb: to, route, fightingTroops, ...cost }
}
export function getAttackableTargets(
  from: string,
  amount: number,
  actor?: Owner,
): CampaignPreview[] {
  const store = useGameStore()
  const faction = actor ?? store.currentFaction
  if (!faction) return []
  const candidates = routesFrom(from, faction, store.cities)
  return [...candidates.keys()]
    .filter((to) => to !== from && store.cities[to]?.owner !== faction)
    .map((to) => previewCampaign(from, to, amount, 'battle', faction))
    .filter((p) => p.ok)
    .sort(
      (a, b) =>
        (a.route?.costDistanceKm ?? Infinity) - (b.route?.costDistanceKm ?? Infinity) ||
        a.targetGb.localeCompare(b.targetGb),
    )
}

/** Compact legal starting points; decision-making still belongs to the model. */
export function buildCampaignContext(faction: Owner): string {
  const store = useGameStore()
  const options: CampaignPreview[] = []
  for (const city of Object.values(store.cities)) {
    if (city.owner !== faction || (city.troops < 0.1 && city.fieldForce <= 0)) continue
    options.push(...getAttackableTargets(city.gb, Math.min(1, city.troops), faction).slice(0, 2))
  }
  options.sort((a, b) => (a.silver ?? 0) - (b.silver ?? 0))
  const name = (gb: string) => getDisplayName(gb) || store.cities[gb]?.name || gb
  const rows = options.slice(0, CAMPAIGN_AI_TARGET_LIMIT).map((p) => {
    const target = store.cities[p.targetGb]!
    return `${name(p.order.from!)} → ${name(p.targetGb)}（新增出兵${p.order.deployAmount ?? 0}k/参战${p.fightingTroops}k，守军${target.troops}k，银${p.silver}/粮${p.food}，${p.route?.seaLegs ? '含海路' : '陆路'}）`
  })
  return [
    '行军规则：中途只可经过己方城市，敌方仅可作为进攻终点；不能穿越第三方或盟友领土。跨海仅允许指定游戏航线，海路成本较高。调兵也须己方连通。',
    `当前可执行进攻示例（最多${CAMPAIGN_AI_TARGET_LIMIT}条，1k仅为预览示例，出兵量需自行判断；未列出的路线不一定非法）：`,
    ...(rows.length
      ? rows
      : [
          '当前无可执行进攻示例；可能是兵力、银粮、行动点或停战约束。优先查询局势、发展、集结或结束回合。',
        ]),
  ].join('\n')
}
