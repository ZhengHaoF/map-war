import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import raw from '@/data/chinaCities.seed.json'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, executeOrder } from '@/utils/gameOrders'
import { CITY_CONNECTIONS, getCityNeighbours, findCampaignRoute } from '@/utils/campaignRoutes'
import {
  previewCampaign,
  getAttackableTargets,
  buildCampaignContext,
} from '@/utils/campaignPreview'
import { marchCost } from '@/utils/economy'
import { useGameScheduler } from '@/composables/useGameScheduler'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => { graphics: object; stop: () => void }>(() => ({
    graphics: {},
    stop: vi.fn<() => void>(),
  })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(
    raw
      .filter((c) => c.gb)
      .map((c, i) => ({
        type: 'Feature',
        properties: { gb: c.gb, name: c.name },
        geometry: { type: 'Point', coordinates: [100 + i / 1000, 30] },
      })) as any,
    'gb',
  )
  resetBattleRuntime()
  init({} as any, undefined as any, {} as any)
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
})
function world() {
  const store = useGameStore()
  const first = CITY_CONNECTIONS.find(
    (e) =>
      e.kind === 'land' &&
      getCityNeighbours(e.to).some((c) => c !== e.from && !getCityNeighbours(e.from).includes(c)),
  )!
  const a = first.from,
    b = first.to
  const c = getCityNeighbours(b).find((id) => id !== a && !getCityNeighbours(a).includes(id))!
  // Controlled test world; production ownership changes use immutable capture events.
  store.cities = Object.fromEntries(
    Object.entries(store.cities).map(([id, city]) => [
      id,
      {
        ...city,
        owner: id === a || id === b ? Owner.SCC : Owner.KMT,
        troops: 10,
        fieldForce: 0,
      },
    ]),
  )
  return { store, a, b, c }
}
describe('campaign execution and preview parity', () => {
  it('executes the exact previewed route, cost and action spend', async () => {
    const { store, a, c } = world()
    const preview = previewCampaign(a, c, 2)
    expect(preview.ok).toBe(true)
    const before = { silver: store.getTreasury(Owner.SCC), food: store.getGranary(Owner.SCC) }
    const result = await executeOrder(preview.order)
    expect(result.ok).toBe(true)
    expect(result.cost).toEqual({ silver: preview.silver, food: preview.food })
    expect(store.getTreasury(Owner.SCC)).toBeCloseTo(before.silver - preview.silver!)
    expect(store.getGranary(Owner.SCC)).toBeCloseTo(before.food - preview.food!)
    expect(store.getActionPoints(Owner.SCC)).toBe(5)
    expect(store.cities[a]!.troops).toBe(8)
    expect(store.battles[0]?.route).toEqual(preview.route?.path)
    expect(store.battles[0]?.marchDistanceKm).toBe(preview.route?.costDistanceKm)
    expect(store.battles[0]?.supplyRulesVersion).toBe(1)
  })
  it('blocks enemy transit before deployment, money and points change', async () => {
    const { store, a, b, c } = world()
    store.cities = { ...store.cities, [b]: { ...store.cities[b]!, owner: Owner.KMT } }
    const before = store.getSnapshot()
    const result = await executeOrder({ order: 'battle', from: a, to: c, deployAmount: 1 })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('无合法进攻路线')
    expect(store.getSnapshot()).toEqual(before)
    expect(store.getActionPoints(Owner.SCC)).toBe(6)
  })
  it('never trusts a route supplied by model JSON', async () => {
    const { store, a, b, c } = world()
    store.cities[b]!.owner = Owner.KMT
    const result = await executeOrder({
      order: 'battle',
      from: a,
      to: c,
      deployAmount: 1,
      route: [a, c],
    } as any)
    expect(result.ok).toBe(false)
  })
  it('blocks disconnected friendly transfers and allows connected ones', async () => {
    const { store, a, b, c } = world()
    store.cities = {
      ...store.cities,
      [b]: { ...store.cities[b]!, owner: Owner.KMT },
      [c]: { ...store.cities[c]!, owner: Owner.SCC },
    }
    expect((await executeOrder({ order: 'moveTroops', from: a, to: c, amount: 1 })).ok).toBe(false)
    store.cities = { ...store.cities, [b]: { ...store.cities[b]!, owner: Owner.SCC } }
    const preview = previewCampaign(a, c, 1, 'moveTroops')
    expect(preview.ok).toBe(true)
    const before = store.getTreasury(Owner.SCC)
    expect((await executeOrder(preview.order)).ok).toBe(true)
    expect(store.cities[a]!.troops).toBe(9)
    expect(store.cities[c]!.troops).toBe(11)
    expect(store.getTreasury(Owner.SCC)).toBeCloseTo(before - preview.silver!)
  })
  it('rechecks routes after an ownership change between preview and execution', async () => {
    const { store, a, b, c } = world()
    const preview = previewCampaign(a, c, 1)
    expect(preview.ok).toBe(true)
    store.cities[b]!.owner = Owner.KMT // Invalidate the cached ownership signature too.
    expect((await executeOrder(preview.order)).ok).toBe(false)
  })
  it('charges sea lanes using the same cost shown in preview', async () => {
    const { store } = world()
    const lane = CITY_CONNECTIONS.find((e) => e.kind === 'sea')!
    store.cities = {
      ...store.cities,
      [lane.from]: { ...store.cities[lane.from]!, owner: Owner.SCC },
    }
    const preview = previewCampaign(lane.from, lane.to, 1)
    expect(preview.ok).toBe(true)
    expect(preview.route?.seaLegs).toBe(1)
    expect(preview.silver).toBe(marchCost(lane.distanceKm * 2, 1).silver)
    expect((await executeOrder(preview.order)).ok).toBe(true)
    expect(store.battles[0]?.routeHasSea).toBe(true)
  })
  it('includes predeployed forces in the cost, not only the newly deployed soldiers', async () => {
    const { store, a, c } = world()
    store.applyEvent({ type: 'deploy', fromGb: a, amount: 3 })
    const preview = previewCampaign(a, c, 2)
    expect(preview.fightingTroops).toBe(5)
    expect(preview.silver).toBe(marchCost(preview.route!.costDistanceKm, 5).silver)
    const before = store.getTreasury(Owner.SCC)
    expect((await executeOrder(preview.order)).ok).toBe(true)
    expect(store.getTreasury(Owner.SCC)).toBeCloseTo(before - preview.silver!)
  })
  it('can use already deployed forces with zero new soldiers, without accidentally deploying the garrison', async () => {
    const { store, a, c } = world()
    store.applyEvent({ type: 'deploy', fromGb: a, amount: 3 })
    const preview = previewCampaign(a, c, 0)
    expect(preview.ok).toBe(true)
    expect(preview.order.deployAmount).toBeUndefined()
    expect(preview.fightingTroops).toBe(3)
    expect((await executeOrder(preview.order)).ok).toBe(true)
    expect(store.cities[a]!.troops).toBe(7)
    expect(store.cities[a]!.fieldForce).toBe(3)
  })
  it('excludes truce and allied endpoints from the UI/AI targets', async () => {
    const { store, a, c } = world()
    expect(getAttackableTargets(a, 1).some((p) => p.targetGb === c)).toBe(true)
    store.applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.KMT, status: 'alliance' })
    expect(getAttackableTargets(a, 1)).toHaveLength(0)
    expect(previewCampaign(a, c, 1).reason).toContain('同盟')
    store.applyEvent({
      type: 'relationChange',
      a: Owner.SCC,
      b: Owner.KMT,
      status: 'peace',
      truceUntil: '1932-01-01',
    })
    expect(getAttackableTargets(a, 1)).toHaveLength(0)
    expect(previewCampaign(a, c, 1).reason).toContain('停战')
  })
  it('excludes unfunded or depleted orders and explains the reason', () => {
    const { store, a, c } = world()
    store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: 6 })
    expect(getAttackableTargets(a, 1)).toHaveLength(0)
    expect(previewCampaign(a, c, 1).reason).toContain('回合行动点不足')
    expect(buildCampaignContext(Owner.SCC)).toContain('当前无可执行进攻示例')
  })
  it('stores optional routes in save/replay while accepting old route-less events', () => {
    const { store, a, b, c } = world()
    store.applyEvent({
      type: 'battleStart',
      battleId: 'route-save',
      fromGb: a,
      targetGb: c,
      fromName: a,
      toName: c,
      attacker: Owner.SCC,
      defender: Owner.KMT,
      route: [a, b, c],
      marchDistanceKm: 100,
      routeHasSea: true,
    })
    store.applyEvent({
      type: 'battleStart',
      battleId: 'legacy-save',
      fromGb: b,
      targetGb: c,
      fromName: b,
      toName: c,
      attacker: Owner.SCC,
      defender: Owner.KMT,
    })
    store.save('campaign-replay')
    store.load('campaign-replay')
    store.isReplaying = false
    expect(store.battles.find((battle) => battle.id === 'route-save')).toMatchObject({
      route: [a, b, c],
      marchDistanceKm: 100,
      routeHasSea: true,
    })
    expect(
      store.battles.find((battle) => battle.id === 'legacy-save')?.marchDistanceKm,
    ).toBeUndefined()
  })
  it('computes reachability independently of map geometry registration and zoom', () => {
    const { store, a, c } = world()
    const first = findCampaignRoute(a, c, Owner.SCC, store.cities)
    clearLocations()
    expect(findCampaignRoute(a, c, Owner.SCC, store.cities)).toEqual(first)
  })
})
