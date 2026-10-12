import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import { executeOrder, init, resetBattleRuntime } from '@/utils/gameOrders'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { computeActionCost } from '@/utils/economy'
import { previewCampaign } from '@/utils/campaignPreview'

const mocks = vi.hoisted(() => ({
  develop: vi.fn<() => Promise<void>>(), battle: vi.fn<() => unknown>(),
  settle: vi.fn<(...args: unknown[]) => Promise<object>>(),
}))
vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => void>(), playScoutAnimation: vi.fn<() => void>(),
  startBattleAnimation: mocks.battle, playCaptureAnimation: vi.fn<() => void>(),
  playDevelopAnimation: mocks.develop,
}))
vi.mock('@/utils/aiDiplomacy', () => ({
  invokeDiplomacyRoute: vi.fn<() => Promise<object>>(), invokeDiplomacyReply: vi.fn<() => Promise<object>>(),
  invokeDiplomacySettle: mocks.settle,
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
beforeEach(() => {
  localStorage.clear()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  useDiplomacyBus().recoverSession()
  clearLocations()
  registerLocations(Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
    type: 'Feature', properties: { gb, name: store.cities[gb]!.name },
    geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
  })), 'gb')
  resetBattleRuntime()
  init({} as never)
  mocks.develop.mockReset()
  mocks.battle.mockReset()
  mocks.settle.mockReset()
  mocks.settle.mockResolvedValue({ narrative: '条约' })
})
describe('architecture boundary invariants', () => {
  it('snapshot relations and route arrays are detached from world state', () => {
    const store = useGameStore()
    store.applyEvent({ type: 'relationChange', a: Owner.SHX, b: Owner.GXC, status: 'peace' })
    store.applyEvent({ type: 'battleStart', battleId: 'review', fromGb: '156511500',
      targetGb: '156530600', fromName: '宜宾', toName: '昭通',
      attacker: Owner.SCC, defender: Owner.YUN, route: ['a', 'b'] })
    const snapshot = store.getSnapshot()
    snapshot.relations['GXC-SHX']!.status = 'war'
    snapshot.battles[0]!.route!.push('changed')
    expect(store.relations['GXC-SHX']!.status).toBe('peace')
    expect(store.battles[0]!.route).toEqual(['a', 'b'])
  })
  it.each([Infinity, NaN, -1, 100_000])('invalid reducer movement %s never creates troops', amount => {
    const store = useGameStore()
    const [a, b] = Object.values(store.cities).filter(c => c.owner === Owner.SCC)
    const before = store.getSnapshot()
    expect(store.applyEvent({ type: 'moveTroops', fromGb: a!.gb, toGb: b!.gb, amount }).ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
  })
  it('transaction rejects later invalid effect without retaining earlier cost or action spend', () => {
    const store = useGameStore()
    const before = store.getSnapshot()
    const log = [...store.eventLog]
    expect(store.applyEvents([
      { type: 'actionSpent', faction: Owner.SCC, amount: 1 },
      { type: 'treasuryChange', faction: Owner.SCC, delta: -10 },
      { type: 'deploy', fromGb: 'missing', amount: 5 },
    ]).ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.getActionPoints(Owner.SCC)).toBe(6)
    expect(store.eventLog).toEqual(log)
  })
  it.each([null, { type: 'unknown' }, { type: 'economicTick', entries: [{}] },
    { type: 'dateAdvance', date: 'broken' }, { type: 'relationChange', a: 'SCC', b: 'SHX' }])(
    'corrupt saved event %j leaves the current world untouched', event => {
      const store = useGameStore()
      store.applyEvent({ type: 'dateAdvance', date: '1931-04-08' })
      const before = store.getSnapshot()
      const log = [...store.eventLog]
      store.save('review')
      const key = 'mapwar_save_review'
      const data = JSON.parse(localStorage.getItem(key)!)
      data.eventLog.push(event)
      localStorage.setItem(key, JSON.stringify(data))
      expect(store.load('review')).toBe(false)
      expect(store.getSnapshot()).toEqual(before)
      expect(store.eventLog).toEqual(log)
      expect(store.isReplaying).toBe(false)
    })
  it('successful load completes replay without requiring a map component', () => {
    const store = useGameStore()
    store.save('review')
    expect(store.load('review')).toBe(true)
    expect(store.isReplaying).toBe(false)
    const count = store.eventLog.length
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: 10 })
    expect(store.eventLog).toHaveLength(count + 1)
  })
  it.each([
    { diplomacyRecords: [{}] }, { telegrams: [{}] }, { turnCount: -1 },
    { fastWorldDomestic: 'yes' }, { pendingTurn: { version: 1, stage: 'unknown' } },
  ])('corrupt saved metadata %j cannot replace the current world', metadata => {
    const store = useGameStore()
    store.save('review')
    const before = store.getSnapshot(), log = [...store.eventLog]
    const key = 'mapwar_save_review'
    localStorage.setItem(key, JSON.stringify({
      ...JSON.parse(localStorage.getItem(key)!), ...metadata,
    }))
    expect(store.load('review')).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.eventLog).toEqual(log)
  })
  it('animation exception does not undo a committed recruit or refund action points', async () => {
    const store = useGameStore()
    const city = Object.values(store.cities).find(c => c.owner === Owner.SCC)!
    const silver = store.getTreasury(Owner.SCC), troops = city.troops
    mocks.develop.mockRejectedValueOnce(new Error('renderer failed'))
    const result = await executeOrder({ order: 'recruit', gb: city.gb, amount: 1 })
    expect(result.ok).toBe(true)
    expect(store.getTreasury(Owner.SCC)).toBe(silver - computeActionCost('recruit', 1).silver)
    expect(store.cities[city.gb]!.troops).toBe(troops + 1)
    expect(store.getActionPoints(Owner.SCC)).toBe(5)
  })
  it('headless battle is committed even if creating its visual throws', async () => {
    const store = useGameStore()
    const preview = previewCampaign('156511500', '156530600', 1, 'battle', Owner.SCC)
    expect(preview.ok).toBe(true)
    const silver = store.getTreasury(Owner.SCC)
    mocks.battle.mockImplementationOnce(() => { throw new Error('renderer failed') })
    const result = await executeOrder(preview.order)
    expect(result.ok).toBe(true)
    expect(store.battles).toHaveLength(1)
    expect(store.battles[0]!.id).toBe((result as { id: string }).id)
    expect(store.getTreasury(Owner.SCC)).toBeCloseTo(silver - preview.silver!)
    expect(store.getActionPoints(Owner.SCC)).toBe(5)
  })
  it('AI alliance requires a separate recipient consent policy', () => {
    const store = useGameStore()
    const record = useDiplomacyBus().startAiDiplomacy(Owner.SHX, Owner.GXC, 'alliance', 'proposal')
    expect(record!.finalStance).toBe('reject')
    expect(store.relationBetween(Owner.SHX, Owner.GXC).status).not.toBe('alliance')
  })
  it('AI war proposal cannot bypass a truce', () => {
    const store = useGameStore()
    store.applyEvent({ type: 'relationChange', a: Owner.SHX, b: Owner.GXC,
      status: 'peace', truceUntil: '1932-01-01' })
    expect(useDiplomacyBus().startAiDiplomacy(Owner.SHX, Owner.GXC, 'war', 'proposal')).toBeNull()
    expect(store.relationBetween(Owner.SHX, Owner.GXC).status).toBe('peace')
  })
  it('late diplomacy result cannot write into a loaded world, even if transport ignores abort', async () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()
    store.save('review')
    bus.startAiDiplomacy(Owner.SHX, Owner.SCC, 'alliance', 'proposal')
    let release!: (value: { narrative: string }) => void
    mocks.settle.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = bus.forceSettle()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(mocks.settle).toHaveBeenCalledTimes(1)
    expect(store.load('review')).toBe(true)
    store.requestMapReload()
    bus.recoverSession()
    await pending
    const before = store.getSnapshot()
    const log = [...store.eventLog]
    release({ narrative: 'old session' })
    await Promise.resolve()
    expect(store.getSnapshot()).toEqual(before)
    expect(store.eventLog).toEqual(log)
  })
  it('treaty cannot pay several individually affordable amounts beyond the total budget', async () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()
    bus.startAiDiplomacy(Owner.SHX, Owner.SCC, 'peace', 'proposal',
      Array.from({ length: 3 }, () => ({ type: 'transferSilver' as const, amount: 500 })))
    const before = store.getSnapshot()
    await bus.forceSettle()
    expect(store.getSnapshot()).toEqual(before)
  })
})
