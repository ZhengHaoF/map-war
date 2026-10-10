import { beforeEach, describe, it, expect } from 'vitest'
import { useGameStore, type CityState } from '@/stores/game'
import { Owner } from '@/data/owners'
import { economyOutlook, resourceRunway } from '@/utils/economyOutlook'
import { buildStrategyContext } from '@/utils/strategyContext'
import { buildFactionContext, buildMinorContext } from '@/utils/aiContext'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { famineTroops } from '@/utils/economy'
import { describeEvent } from '@/utils/eventDescribe'

beforeEach(() => {
  const s = useGameStore()
  s.initWorld()
  s.selectFaction(Owner.SCC)
})
function single(): CityState {
  const s = useGameStore()
  return {
    ...Object.values(s.cities).find((c) => c.owner === Owner.SCC)!,
    troops: 20,
    fieldForce: 10,
    cityLevel: 1,
    industry: 10,
    food: 10,
    occupationUntilTurn: undefined,
  }
}
describe('economic outlook', () => {
  it.each([
    [100, -20, 5],
    [0, -20, 0],
    [-2, 5, 0],
    [100, 0, null],
    [100, 20, null],
  ] as const)(
    'estimates a conservative static runway for balance=%s net=%s',
    (balance, net, result) => {
      expect(resourceRunway(balance, net)).toBe(result)
    },
  )
  it('advises no recruitment when existing troops already run a deficit', () => {
    const city = single(),
      p = economyOutlook({ [city.gb]: city }, Owner.SCC, 0, 100, 100)
    expect(p.goal).toBe('保粮')
    expect(p.recruitLimit).toBe(0)
    expect(p.reserveSilver).toBeCloseTo(30)
    expect(p.reserveFood).toBeCloseTo(15)
  })
  it('counts purchase and three turns of new upkeep, not just current affordability', () => {
    const city = {
      ...single(),
      cityLevel: 5,
      industry: 100,
      food: 100,
      troops: 0,
      fieldForce: 0,
      morale: 70,
    }
    const p = economyOutlook({ [city.gb]: city }, Owner.SCC, 0, 35, 19)
    expect(p.recruitLimit).toBe(10)
    expect(p.goal).toBe('择机扩张')
  })
  it('counts occupation-adjusted income and returns to normal at consolidation end', () => {
    const city = {
      ...single(),
      cityLevel: 5,
      industry: 100,
      food: 100,
      troops: 0,
      fieldForce: 0,
      occupationUntilTurn: 2,
    }
    const p = economyOutlook({ [city.gb]: city }, Owner.SCC, 1, 500, 500)
    const ready = economyOutlook({ [city.gb]: city }, Owner.SCC, 2, 500, 500)
    expect(p.pending).toBe(1)
    expect(p.goal).toBe('整合')
    expect(p.eco.foodNet).toBe(ready.eco.foodNet / 2)
  })
  it('puts the same advisory forecast in faction and minor model contexts', () => {
    const text = buildStrategyContext(Owner.SCC)
    expect(text).toContain('不是每条')
    expect(text).toContain('不能当作保证')
    expect(text).toContain('外出不能规避缺粮')
    expect(buildFactionContext(Owner.SCC)).toContain(text)
    expect(buildMinorContext([Owner.SCC])).toContain(text)
  })
})
describe('new starvation without changing legacy replay', () => {
  it('reports existing debt even if this turn has positive net income', () => {
    const c = { ...single(), cityLevel: 5, industry: 100, food: 100, troops: 0, fieldForce: 0 }
    const event = buildEconomicTickEvent({
      cities: { [c.gb]: c },
      activeFactions: [Owner.SCC],
      turnCount: 0,
      getTreasury: () => -100,
      getGranary: () => -100,
    })
    expect(event.entries[0]?.arrear).toBe(true)
    expect(event.entries[0]?.famine).toBe(true)
  })
  it.each([
    [20, 19.6],
    [10, 9.8],
    [1, 0.9],
    [0.1, 0],
    [0, 0],
  ])('attrits a %sk force to %sk', (troops, result) => {
    expect(famineTroops(troops)).toBe(result)
  })
  it('uses a versioned production event and attrits garrison and deployed troops', () => {
    const s = useGameStore(),
      c = single()
    s.cities = { [c.gb]: { ...c, food: 0 } }
    while (s.getGranary(Owner.SCC) > 0)
      s.applyEvent({
        type: 'granaryChange',
        faction: Owner.SCC,
        delta: -Math.min(100, s.getGranary(Owner.SCC)),
      })
    const event = buildEconomicTickEvent(s)
    expect(event.attritionVersion).toBe(2)
    s.applyEvent(event)
    expect(s.cities[c.gb]?.troops).toBe(19.6)
    expect(s.cities[c.gb]?.fieldForce).toBe(9.8)
    expect(describeEvent(event, s.cities)).toContain('外出部队减员')
  })
  it('keeps unversioned old ticks integer-rounded and deployed troops unchanged', () => {
    const s = useGameStore(),
      c = single()
    s.cities = { [c.gb]: { ...c, food: 0 } }
    while (s.getGranary(Owner.SCC) > 0)
      s.applyEvent({
        type: 'granaryChange',
        faction: Owner.SCC,
        delta: -Math.min(100, s.getGranary(Owner.SCC)),
      })
    const event = buildEconomicTickEvent(s)
    delete event.attritionVersion
    s.applyEvent(event)
    expect(s.cities[c.gb]?.troops).toBe(20)
    expect(s.cities[c.gb]?.fieldForce).toBe(10)
  })
  it('rebuilds new famine results exactly from real-seed events after save/load', () => {
    const s = useGameStore(),
      c = Object.values(s.cities).find((c) => c.owner === Owner.SCC && c.troops >= 2)!
    s.applyEvent({ type: 'deploy', fromGb: c.gb, amount: 2 })
    while (s.getGranary(Owner.SCC) >= 0)
      s.applyEvent({
        type: 'granaryChange',
        faction: Owner.SCC,
        delta: -Math.min(100, s.getGranary(Owner.SCC) + 100),
      })
    const event = buildEconomicTickEvent(s)
    // Make scarcity persist despite initial positive food production; legitimate
    // capped resource events are replayable, not direct fixture writes.
    while (
      s.getGranary(Owner.SCC) + event.entries.find((e) => e.faction === Owner.SCC)!.foodDelta >=
      0
    )
      s.applyEvent({ type: 'granaryChange', faction: Owner.SCC, delta: -100 })
    const actualEvent = buildEconomicTickEvent(s)
    s.applyEvent(actualEvent)
    const before = { ...s.cities[c.gb] }
    s.save('famine-replay')
    s.load('famine-replay')
    s.isReplaying = false
    expect(s.cities[c.gb]).toEqual(before)
  })
})
