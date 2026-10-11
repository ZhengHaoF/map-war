import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES, getCityNeighbours } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { validateFactionOrders, validatePlayerOrders } from '@/utils/aiOrderContract'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({ flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))

const source = '156510100' // 成都
const target = '156511500' // 宜宾
const enemy = '156530600' // 昭通
const transfer: GameOrder = { order: 'moveTroops', from: source, to: target, amount: 15 }
const deploy: GameOrder = { order: 'deploy', from: target, amount: 15 }
beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  store.cities = {
    ...store.cities,
    [source]: { ...store.cities[source]!, troops: 20, fieldForce: 0 },
    [target]: { ...store.cities[target]!, troops: 5, fieldForce: 0 },
  }
  clearLocations()
  registerLocations(Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
    type: 'Feature', properties: { gb, name: store.cities[gb]!.name },
    geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
  })), 'gb')
  resetBattleRuntime()
  init({} as never, undefined, {} as never)
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
})
function preflight(orders: GameOrder[], mode: 'faction' | 'player' = 'faction') {
  const store = useGameStore()
  return (mode === 'player' ? validatePlayerOrders : validateFactionOrders)(
    orders, Owner.SCC, gb => store.ownership[gb], gb => store.cities[gb]?.troops,
  )
}
async function run(orders: GameOrder[], mode: 'faction' | 'player' = 'faction') {
  const scheduler = useGameScheduler()
  scheduler.submit(orders, { authority: mode, actor: Owner.SCC, presentation: 'fast' })
  await scheduler.advance()
  return scheduler.executionResults.value
}
function drain(kind: 'silver' | 'food') {
  const store = useGameStore()
  const balance = () => kind === 'silver' ? store.getTreasury(Owner.SCC) : store.getGranary(Owner.SCC)
  while (balance() > 0) store.applyEvent({
    type: kind === 'silver' ? 'treasuryChange' : 'granaryChange',
    faction: Owner.SCC, delta: -Math.min(50, balance()),
  })
}
describe('sequential preflight through real scheduler and live execution', () => {
  for (const mode of ['faction', 'player'] as const) {
    it(`${mode}: transfers before deploying, charges once, and preserves total troops`, async () => {
      const store = useGameStore()
      const before = store.getSnapshot()
      const batch = preflight([transfer, deploy], mode)
      expect(batch.rejected).toEqual([])
      expect(store.getSnapshot()).toEqual(before)
      const results = await run(batch.approved, mode)
      expect(results.map(r => r.ok)).toEqual([true, true])
      expect(store.cities[source]!.troops).toBe(5)
      expect(store.cities[target]!.troops).toBe(5)
      expect(store.cities[target]!.fieldForce).toBe(15)
      expect(store.getActionPoints(Owner.SCC)).toBe(4)
      expect(store.getTreasury(Owner.SCC)).toBeCloseTo(1200 - results[0]!.cost!.silver)
      expect(store.getGranary(Owner.SCC)).toBeCloseTo(720 - results[0]!.cost!.food)
    })
  }
  for (const kind of ['silver', 'food'] as const) {
    it(`${kind}: a failed transfer never credits imaginary troops or spends points`, async () => {
      const store = useGameStore()
      drain(kind)
      const before = store.getSnapshot()
      const results = await run(preflight([transfer, deploy]).approved)
      expect(results.map(r => r.ok)).toEqual([false, false])
      expect(results[0]?.reason).toContain('银粮不足')
      expect(results[1]?.reason).toContain('超过驻军')
      expect(store.getSnapshot()).toEqual(before)
      expect(store.eventLog.filter(e => e.type === 'commandReceipt').slice(-2))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ ok: false, spentPoints: 0, spentSilver: 0, spentFood: 0 }),
        ]))
    })
  }
  it('a filtered-out predecessor cannot authorize deployment', async () => {
    const store = useGameStore()
    const approved = preflight([transfer, deploy]).approved
    const before = store.getSnapshot()
    const results = await run(approved.slice(1)) // world validation removed transfer
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.reason).toContain('超过驻军')
    expect(store.getSnapshot()).toEqual(before)
  })
  it('rechecks action points after the transfer and reports a zero-cost deployment refusal', async () => {
    const store = useGameStore()
    store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: 5 })
    const results = await run(preflight([transfer, deploy]).approved)
    expect(results.map(r => r.ok)).toEqual([true, false])
    expect(store.cities[target]!.troops).toBe(20)
    expect(store.cities[target]!.fieldForce).toBe(0)
    expect(store.getActionPoints(Owner.SCC)).toBe(0)
    expect(store.eventLog.at(-1)).toMatchObject({
      type: 'commandReceipt', ok: false, spentPoints: 0, spentSilver: 0, spentFood: 0,
    })
  })
  it('rechecks ownership changed after preflight, without spending', async () => {
    const store = useGameStore()
    const approved = preflight([transfer, deploy]).approved
    store.cities = { ...store.cities, [target]: { ...store.cities[target]!, owner: Owner.YUN } }
    const before = store.getSnapshot()
    expect((await run(approved)).map(r => r.ok)).toEqual([false, false])
    expect(store.getSnapshot()).toEqual(before)
  })
  it('a disconnected transfer fails without enabling the dependent deployment', async () => {
    const store = useGameStore()
    const remote = Object.keys(CITY_CONNECTION_NODES)
      .find(gb => gb !== target && !getCityNeighbours(target).includes(gb))!
    store.cities = Object.fromEntries(Object.entries(store.cities).map(([gb, city]) => [
      gb, { ...city, owner: gb === remote || gb === target ? Owner.SCC : Owner.KMT },
    ]))
    store.cities = { ...store.cities, [remote]: { ...store.cities[remote]!, troops: 20 } }
    const before = store.getSnapshot()
    const results = await run(preflight([{ ...transfer, from: remote }, deploy]).approved)
    expect(results.map(r => r.ok)).toEqual([false, false])
    expect(results[0]?.reason).toContain('无合法调兵路线')
    expect(results[1]?.reason).toContain('超过驻军')
    expect(store.getSnapshot()).toEqual(before)
  })
  it('never allows cumulative deployments to consume more than actual transferred troops', async () => {
    const store = useGameStore()
    const results = await run(preflight([transfer, deploy, deploy]).approved)
    expect(results.map(r => r.ok)).toEqual([true, true, false])
    expect(store.cities[target]!.troops).toBe(5)
    expect(store.cities[target]!.fieldForce).toBe(15)
    expect(store.getActionPoints(Owner.SCC)).toBe(4)
  })
  it('supports recruitment before transfer and deployment through the same live checks', async () => {
    const store = useGameStore()
    const recruit: GameOrder = { order: 'recruit', gb: source, amount: 5 }
    const move: GameOrder = { ...transfer, amount: 25 }
    const results = await run(preflight([recruit, move, { ...deploy, amount: 25 }]).approved)
    expect(results.map(r => r.ok)).toEqual([true, true, true])
    expect(store.cities[source]!.troops).toBe(0)
    expect(store.cities[target]!.troops).toBe(5)
    expect(store.cities[target]!.fieldForce).toBe(25)
    expect(store.getActionPoints(Owner.SCC)).toBe(3)
  })
  it('also rechecks explicit battle deployment after reinforcements', async () => {
    const store = useGameStore()
    const attack: GameOrder = { order: 'battle', from: target, to: enemy, deployAmount: 15 }
    expect((await run(preflight([transfer, attack]).approved)).map(r => r.ok)).toEqual([true, true])
    expect(store.cities[target]!.troops).toBe(5)
    expect(store.battles[0]?.attacker).toBe(Owner.SCC)
  })
})
