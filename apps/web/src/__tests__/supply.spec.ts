import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore, type CityState } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTIONS, getCityNeighbours } from '@/utils/campaignRoutes'
import {
  INITIAL_SUPPLY_HUBS,
  getSupplyStatus,
  occupationRemaining,
  cityYieldMultiplier,
  isSupplyHub,
} from '@/utils/supply'
import { computeFactionEconomy, marchCost, expeditionFactor } from '@/utils/economy'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { computeBaseBattle } from '@/utils/battleFormula'
import { flavorBattles } from '@/utils/ai'
import { BATTLE_MIN_ATTRITION_PER_ROUND, UNSUPPLIED_BATTLE_FACTOR } from '@/data/gameConfig'

vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
}))
beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
})
function connectedWorld() {
  const store = useGameStore()
  const edge = CITY_CONNECTIONS.find(
    (e) =>
      e.kind === 'land' &&
      !INITIAL_SUPPLY_HUBS.has(e.from) &&
      !INITIAL_SUPPLY_HUBS.has(e.to) &&
      getCityNeighbours(e.to).some(
        (id) =>
          id !== e.from && !getCityNeighbours(e.from).includes(id) && !INITIAL_SUPPLY_HUBS.has(id),
      ),
  )!
  const a = edge.from,
    b = edge.to
  const c = getCityNeighbours(b).find(
    (id) => id !== a && !getCityNeighbours(a).includes(id) && !INITIAL_SUPPLY_HUBS.has(id),
  )!
  const city = (gb: string, level: number): CityState => ({
    ...store.cities[gb]!,
    owner: Owner.SCC,
    cityLevel: level,
    troops: 20,
    fieldForce: 0,
    morale: 70,
    terrain: 'PLAIN',
    fort: 0,
  })
  return { a, b, c, cities: { [a]: city(a, 2), [b]: city(b, 3), [c]: city(c, 2) } }
}
describe('lightweight supply and consolidation', () => {
  it('gives all initial owned components supply, including starting enclaves and level-2 factions', () => {
    const store = useGameStore()
    for (const city of Object.values(store.cities)) {
      if (city.owner === Owner.NEUTRAL) continue
      expect({
        city: city.gb,
        supplied: getSupplyStatus(city.gb, city.owner, store.cities, 0).supplied,
      }).toEqual({ city: city.gb, supplied: true })
    }
  })
  it('detects a lost connection and recovers after reconnection', () => {
    const { a, b, cities } = connectedWorld()
    expect(getSupplyStatus(a, Owner.SCC, cities, 0)).toMatchObject({
      supplied: true,
      hubGb: b,
      battleFactor: 1,
    })
    cities[b]!.owner = Owner.KMT
    expect(getSupplyStatus(a, Owner.SCC, cities, 0)).toMatchObject({
      supplied: false,
      battleFactor: UNSUPPLIED_BATTLE_FACTOR,
    })
    cities[b]!.owner = Owner.SCC
    expect(getSupplyStatus(a, Owner.SCC, cities, 0).supplied).toBe(true)
  })
  it('does not activate a newly captured hub until consolidation finishes', () => {
    const { a, b, cities } = connectedWorld()
    cities[b]!.occupationUntilTurn = 2
    expect(isSupplyHub(cities[b]!, 0)).toBe(false)
    expect(getSupplyStatus(a, Owner.SCC, cities, 1).supplied).toBe(false)
    expect(getSupplyStatus(a, Owner.SCC, cities, 2).supplied).toBe(true)
  })
  it('does not count an enemy hub or a wrong-owner source', () => {
    const { a, b, cities } = connectedWorld()
    cities[b]!.owner = Owner.KMT
    expect(getSupplyStatus(a, Owner.SCC, cities, 0).supplied).toBe(false)
    expect(getSupplyStatus(b, Owner.SCC, cities, 0).reason).toContain('不属于')
  })
  it('halves taxes and food during consolidation without discounting army upkeep', () => {
    const { a, cities } = connectedWorld()
    const city = { ...cities[a]!, occupationUntilTurn: 2 }
    const first = computeFactionEconomy({ [a]: city }, Owner.SCC, 0)
    const second = computeFactionEconomy({ [a]: city }, Owner.SCC, 1)
    const ready = computeFactionEconomy({ [a]: city }, Owner.SCC, 2)
    // Both totals round independently to 0.1; their ratio may differ by 0.075.
    expect(Math.abs(first.silverTax - ready.silverTax * 0.5)).toBeLessThanOrEqual(
      0.075 + Number.EPSILON * 100,
    )
    expect(Math.abs(first.foodProduce - ready.foodProduce * 0.5)).toBeLessThanOrEqual(
      0.075 + Number.EPSILON * 100,
    )
    expect(second).toEqual(first)
    expect(first.silverUpkeep).toBe(ready.silverUpkeep)
    expect(first.foodUpkeep).toBe(ready.foodUpkeep)
    expect(cityYieldMultiplier(city, 2)).toBe(1)
  })
  it('persists capture consolidation and its remaining turns through save/replay', () => {
    const store = useGameStore()
    const target = Object.values(store.cities).find((c) => c.owner === Owner.KMT)!
    store.applyEvent({
      type: 'capture',
      targetGb: target.gb,
      actor: Owner.SCC,
      resultTroops: 5,
      occupationTurns: 2,
    })
    expect(occupationRemaining(store.cities[target.gb]!, store.turnCount)).toBe(2)
    store.applyEvent({ type: 'dateAdvance', date: '1931-04-08' })
    store.save('consolidation')
    store.load('consolidation')
    store.isReplaying = false
    expect(occupationRemaining(store.cities[target.gb]!, store.turnCount)).toBe(1)
    store.applyEvent({ type: 'dateAdvance', date: '1931-04-15' })
    expect(occupationRemaining(store.cities[target.gb]!, store.turnCount)).toBe(0)
  })
  it('keeps old captures without consolidation markers fully productive', () => {
    const store = useGameStore()
    const target = Object.values(store.cities).find((c) => c.owner === Owner.KMT)!
    store.applyEvent({ type: 'capture', targetGb: target.gb, actor: Owner.SCC })
    expect(store.cities[target.gb]?.occupationUntilTurn).toBeUndefined()
    expect(cityYieldMultiplier(store.cities[target.gb]!, 0)).toBe(1)
  })
  it('does not extend integration on a duplicate same-owner capture', () => {
    const store = useGameStore()
    const target = Object.values(store.cities).find((c) => c.owner === Owner.KMT)!
    store.applyEvent({ type: 'capture', targetGb: target.gb, actor: Owner.SCC, occupationTurns: 2 })
    store.applyEvent({ type: 'dateAdvance', date: '1931-04-08' })
    store.applyEvent({ type: 'capture', targetGb: target.gb, actor: Owner.SCC, occupationTurns: 2 })
    expect(occupationRemaining(store.cities[target.gb]!, store.turnCount)).toBe(1)
  })
  it('marks new battle captures for consolidation even when defenders are already zero', async () => {
    const store = useGameStore()
    const { a, b, cities } = connectedWorld()
    store.cities = {
      [a]: { ...cities[a]!, fieldForce: 20, troops: 0 },
      [b]: { ...cities[b]!, owner: Owner.KMT, troops: 0 },
    }
    store.applyEvent({
      type: 'battleStart',
      battleId: 'empty-city',
      fromGb: a,
      targetGb: b,
      fromName: a,
      toName: b,
      attacker: Owner.SCC,
      defender: Owner.KMT,
      route: [a, b],
      supplyRulesVersion: 1,
    })
    await useGameScheduler().settleActiveBattles()
    expect(store.cities[b]?.owner).toBe(Owner.SCC)
    expect(occupationRemaining(store.cities[b]!, store.turnCount)).toBe(2)
  })
  it.each([0, -1, 11, Infinity, NaN])(
    'ignores malformed consolidation duration (%s)',
    (duration) => {
      const store = useGameStore()
      const target = Object.values(store.cities).find((c) => c.owner === Owner.KMT)!
      store.applyEvent({
        type: 'capture',
        targetGb: target.gb,
        actor: Owner.SCC,
        occupationTurns: duration,
      })
      expect(store.cities[target.gb]?.occupationUntilTurn).toBeUndefined()
    },
  )
  it.each([true, false])(
    'applies logistics only to explicitly versioned new battles (new=%s)',
    async (newRules) => {
      const store = useGameStore()
      const { a, b, cities } = connectedWorld()
      const source = { ...cities[a]!, fieldForce: 20, troops: 0 }
      const target = { ...cities[b]!, owner: Owner.KMT, troops: 20 }
      store.cities = { [a]: source, [b]: target }
      const distance = 100
      const factor = expeditionFactor(distance) * (newRules ? UNSUPPLIED_BATTLE_FACTOR : 1)
      const base = computeBaseBattle({
        atkForce: 20,
        defTroops: 20,
        atkMorale: 70,
        defMorale: 70,
        fort: 0,
        terrain: 'PLAIN',
        distanceFactor: factor,
      })
      store.applyEvent({
        type: 'battleStart',
        battleId: 'supply-round',
        fromGb: a,
        targetGb: b,
        fromName: a,
        toName: b,
        attacker: Owner.SCC,
        defender: Owner.KMT,
        route: [a, b],
        marchDistanceKm: distance,
        ...(newRules ? { supplyRulesVersion: 1 as const } : {}),
      })
      if (newRules)
        vi.mocked(flavorBattles).mockImplementationOnce(async () => {
          // State can change while asynchronous flavor resolves; the log must still
          // describe the same supply snapshot used by this round's formula.
          store.cities = { ...store.cities, [a]: { ...store.cities[a]!, cityLevel: 3 } }
          return {}
        })
      await useGameScheduler().settleActiveBattles()
      expect(store.cities[b]!.troops).toBeCloseTo(
        20 - Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.defenderLoss),
      )
      expect(store.cities[a]!.fieldForce).toBeCloseTo(
        20 - Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.attackerLoss),
      )
      const attack = store.eventLog.find((e) => e.type === 'attack')
      expect(
        (attack && 'narrative' in attack ? (attack.narrative ?? '') : '').includes('断供'),
      ).toBe(newRules)
      expect(marchCost(distance, 1).silver).toBeGreaterThan(0)
    },
  )
})
