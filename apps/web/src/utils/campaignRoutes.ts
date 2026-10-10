/** Pure, deterministic movement topology. Neither map zoom nor model JSON can change it. */
import raw from '@/data/cityConnections.seed.json'
import { SEA_ROUTE_COST_MULTIPLIER } from '@/data/gameConfig'
import type { Owner } from '@/data/owners'

export interface Connection {
  from: string
  to: string
  kind: 'land' | 'sea'
  distanceKm: number
  label?: string
}
export interface CampaignRoute {
  path: string[]
  distanceKm: number
  /** Includes the sea-lane cost multiplier, used by march costs and expedition attrition. */
  costDistanceKm: number
  seaLegs: number
}
export interface RouteCity {
  owner: Owner
}
export const CITY_CONNECTIONS = raw.edges as Connection[]
export const CITY_CONNECTION_NODES = raw.nodes
const neighbours = new Map<string, { to: string; edge: Connection }[]>()
const routeCache = new WeakMap<
  object,
  { ownership: string; sources: Map<string, Map<string, CampaignRoute>> }
>()
for (const edge of CITY_CONNECTIONS) {
  for (const [from, to] of [
    [edge.from, edge.to],
    [edge.to, edge.from],
  ]) {
    const list = neighbours.get(from!) ?? []
    list.push({ to: to!, edge })
    neighbours.set(from!, list)
  }
}
export function getCityNeighbours(gb: string): string[] {
  return (neighbours.get(gb) ?? []).map((n) => n.to)
}

/** Only owned cities may be traversed; an opposing endpoint may be reached, never crossed. */
export function routesFrom(
  from: string,
  actor: Owner,
  cities: Record<string, RouteCity>,
  edges: Connection[] = CITY_CONNECTIONS,
): Map<string, CampaignRoute> {
  if (!cities[from] || cities[from].owner !== actor) return new Map()
  // Ownership signature also invalidates imperative changes in debug/test callers.
  let cache: { ownership: string; sources: Map<string, Map<string, CampaignRoute>> } | undefined
  const cacheKey = `${actor}:${from}`
  if (edges === CITY_CONNECTIONS) {
    const ownership = Object.entries(cities)
      .map(([gb, city]) => `${gb}:${city.owner}`)
      .join('|')
    cache = routeCache.get(cities)
    if (!cache || cache.ownership !== ownership) {
      cache = { ownership, sources: new Map() }
      routeCache.set(cities, cache)
    }
    const existing = cache.sources.get(cacheKey)
    if (existing) return existing
  }
  const graph =
    edges === CITY_CONNECTIONS ? neighbours : new Map<string, { to: string; edge: Connection }[]>()
  if (edges !== CITY_CONNECTIONS)
    for (const edge of edges) {
      for (const [a, b] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ]) {
        const list = graph.get(a!) ?? []
        list.push({ to: b!, edge })
        graph.set(a!, list)
      }
    }
  const routes = new Map<string, CampaignRoute>([
    [from, { path: [from], distanceKm: 0, costDistanceKm: 0, seaLegs: 0 }],
  ])
  const pending = new Set([from])
  const visited = new Set<string>()
  while (pending.size) {
    let current = ''
    let best = Infinity
    for (const id of pending) {
      const d = routes.get(id)!.costDistanceKm
      if (d < best || (d === best && id < current)) {
        current = id
        best = d
      }
    }
    pending.delete(current)
    visited.add(current)
    if (cities[current]?.owner !== actor) continue
    const route = routes.get(current)!
    for (const { to, edge } of graph.get(current) ?? []) {
      if (!cities[to] || visited.has(to)) continue
      const distance =
        route.costDistanceKm +
        edge.distanceKm * (edge.kind === 'sea' ? SEA_ROUTE_COST_MULTIPLIER : 1)
      if (distance >= (routes.get(to)?.costDistanceKm ?? Infinity)) continue
      routes.set(to, {
        path: [...route.path, to],
        distanceKm: route.distanceKm + edge.distanceKm,
        costDistanceKm: distance,
        seaLegs: route.seaLegs + (edge.kind === 'sea' ? 1 : 0),
      })
      if (cities[to].owner === actor) pending.add(to)
    }
  }
  cache?.sources.set(cacheKey, routes)
  return routes
}
export function findCampaignRoute(
  from: string,
  to: string,
  actor: Owner,
  cities: Record<string, RouteCity>,
): CampaignRoute | null {
  if (from === to) return null
  return routesFrom(from, actor, cities).get(to) ?? null
}
