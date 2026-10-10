import { describe, expect, it } from 'vitest'
import { Owner } from '@/data/owners'
import seed from '@/data/chinaCities.seed.json'
import {
  CITY_CONNECTIONS,
  CITY_CONNECTION_NODES,
  routesFrom,
  findCampaignRoute,
  getCityNeighbours,
  type Connection,
} from '@/utils/campaignRoutes'
import { SEA_ROUTE_COST_MULTIPLIER } from '@/data/gameConfig'

const edge = (
  from: string,
  to: string,
  distanceKm = 10,
  kind: 'land' | 'sea' = 'land',
): Connection => ({ from, to, distanceKm, kind })
const owned = (owner = Owner.SCC) => ({ owner })
describe('deterministic game topology', () => {
  it('covers every seeded city, with unique positive bidirectional edges', () => {
    expect(Object.keys(CITY_CONNECTION_NODES).sort()).toEqual(
      seed
        .filter((c) => c.gb)
        .map((c) => c.gb)
        .sort(),
    )
    const seen = new Set<string>()
    for (const e of CITY_CONNECTIONS) {
      expect(e.from).not.toBe(e.to)
      expect(e.distanceKm).toBeGreaterThan(0)
      expect(CITY_CONNECTION_NODES).toHaveProperty(e.from)
      expect(CITY_CONNECTION_NODES).toHaveProperty(e.to)
      const key = [e.from, e.to].sort().join('|')
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(getCityNeighbours(e.from)).toContain(e.to)
      expect(getCityNeighbours(e.to)).toContain(e.from)
    }
  })
  it('is one connected game world, with only four explicit sea lanes', () => {
    const start = Object.keys(CITY_CONNECTION_NODES)[0]!
    const seen = new Set([start]),
      queue = [start]
    while (queue.length) {
      for (const id of getCityNeighbours(queue.pop()!))
        if (!seen.has(id)) {
          seen.add(id)
          queue.push(id)
        }
    }
    expect(seen.size).toBe(375)
    expect(CITY_CONNECTIONS.filter((e) => e.kind === 'sea')).toHaveLength(4)
    expect(CITY_CONNECTIONS.find((e) => e.from === '156710000' && e.to === '156350100')?.kind).toBe(
      'sea',
    )
  })
  it('permits own transit to an opposing endpoint but never traverses it', () => {
    const routes = routesFrom(
      'A',
      Owner.SCC,
      { A: owned(), B: owned(), C: owned(Owner.KMT), D: owned(Owner.KMT) },
      [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
    )
    expect(routes.get('C')?.path).toEqual(['A', 'B', 'C'])
    expect(routes.has('D')).toBe(false)
  })
  it.each([Owner.KMT, Owner.NEUTRAL, Owner.GXC])(
    'blocks transit through another faction (%s)',
    (owner) => {
      const routes = routesFrom('A', Owner.SCC, { A: owned(), B: owned(owner), C: owned() }, [
        edge('A', 'B'),
        edge('B', 'C'),
      ])
      expect(routes.has('C')).toBe(false)
    },
  )
  it('chooses the lowest real movement cost, including sea penalties', () => {
    const cities = { A: owned(), B: owned(), C: owned(Owner.KMT) }
    const routes = routesFrom('A', Owner.SCC, cities, [
      edge('A', 'C', 15, 'sea'),
      edge('A', 'B', 10),
      edge('B', 'C', 10),
    ])
    expect(routes.get('C')?.path).toEqual(['A', 'B', 'C'])
    const sailing = routesFrom('A', Owner.SCC, cities, [edge('A', 'C', 15, 'sea')]).get('C')!
    expect(sailing.costDistanceKm).toBe(15 * SEA_ROUTE_COST_MULTIPLIER)
    expect(sailing.distanceKm).toBe(15)
    expect(sailing.seaLegs).toBe(1)
  })
  it('rejects missing, enemy-source and same-city movement', () => {
    const cities = { A: owned(), B: owned(Owner.KMT) }
    expect(routesFrom('missing', Owner.SCC, cities).size).toBe(0)
    expect(routesFrom('B', Owner.SCC, cities).size).toBe(0)
    expect(findCampaignRoute('A', 'A', Owner.SCC, cities)).toBeNull()
  })
})
