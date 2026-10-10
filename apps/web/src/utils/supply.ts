/** Pure supply/consolidation rules; no LLM calls and no persistent state outside events. */
import seed from '@/data/chinaCities.seed.json'
import type { CityState } from '@/stores/game'
import { Owner } from '@/data/owners'
import {
  SUPPLY_BASE_MIN_LEVEL,
  UNSUPPLIED_BATTLE_FACTOR,
  OCCUPATION_YIELD_FACTOR,
} from '@/data/gameConfig'
import { getCityNeighbours, routesFrom, type CampaignRoute } from './campaignRoutes'

// Every initial owned component gets a regional hub, so starting enclaves are not
// accidentally penalised by modern geometry or an arbitrary capital-name match.
const initial = Object.fromEntries(
  seed
    .filter((c) => c.gb)
    .map((c) => [
      c.gb,
      {
        ...c,
        owner: (c.owner as Owner) ?? Owner.NEUTRAL,
        cityLevel: c.cityLevel ?? 0,
        industry: c.industry ?? 0,
        troops: c.troops ?? 0,
      },
    ]),
)
const seen = new Set<string>()
const hubs = new Set<string>()
for (const id of Object.keys(initial).sort()) {
  if (seen.has(id) || initial[id]!.owner === Owner.NEUTRAL) continue
  const owner = initial[id]!.owner
  const queue = [id],
    component: string[] = []
  seen.add(id)
  while (queue.length) {
    const current = queue.pop()!
    component.push(current)
    for (const neighbour of getCityNeighbours(current)) {
      if (!seen.has(neighbour) && initial[neighbour]?.owner === owner) {
        seen.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  component.sort(
    (a, b) =>
      initial[b]!.cityLevel - initial[a]!.cityLevel ||
      initial[b]!.industry - initial[a]!.industry ||
      initial[b]!.troops - initial[a]!.troops ||
      a.localeCompare(b),
  )
  hubs.add(component[0]!)
}
export const INITIAL_SUPPLY_HUBS: ReadonlySet<string> = hubs
export const SUPPLY_PENALTY_LABEL = `断供 · 进攻战力降低${Math.round((1 - UNSUPPLIED_BATTLE_FACTOR) * 100)}%`
export const OCCUPATION_YIELD_LABEL = `税粮产出${Math.round(OCCUPATION_YIELD_FACTOR * 100)}%`
export function occupationRemaining(
  city: Pick<CityState, 'occupationUntilTurn'>,
  turn: number,
): number {
  return Math.max(0, (city.occupationUntilTurn ?? 0) - turn)
}
export function cityYieldMultiplier(
  city: Pick<CityState, 'occupationUntilTurn'>,
  turn: number,
): number {
  return occupationRemaining(city, turn) > 0 ? OCCUPATION_YIELD_FACTOR : 1
}
export function isSupplyHub(city: CityState, turn: number): boolean {
  return (
    occupationRemaining(city, turn) === 0 &&
    (city.cityLevel >= SUPPLY_BASE_MIN_LEVEL || INITIAL_SUPPLY_HUBS.has(city.gb))
  )
}
export interface SupplyStatus {
  supplied: boolean
  hubGb?: string
  route?: CampaignRoute
  battleFactor: number
  reason: string
}
export function getSupplyStatus(
  sourceGb: string,
  actor: Owner,
  cities: Record<string, CityState>,
  turn: number,
): SupplyStatus {
  const source = cities[sourceGb]
  if (!source || source.owner !== actor)
    return { supplied: false, battleFactor: UNSUPPLIED_BATTLE_FACTOR, reason: '来源城不属于该势力' }
  const routes = routesFrom(sourceGb, actor, cities)
  const options = Object.values(cities)
    .filter((city) => city.owner === actor && isSupplyHub(city, turn) && routes.has(city.gb))
    .sort(
      (a, b) =>
        routes.get(a.gb)!.costDistanceKm - routes.get(b.gb)!.costDistanceKm ||
        a.gb.localeCompare(b.gb),
    )
  const hub = options[0]
  if (hub)
    return {
      supplied: true,
      hubGb: hub.gb,
      route: routes.get(hub.gb),
      battleFactor: 1,
      reason: '已连通整合完成的补给中心',
    }
  return {
    supplied: false,
    battleFactor: UNSUPPLIED_BATTLE_FACTOR,
    reason: '未连通整合完成的补给中心',
  }
}
