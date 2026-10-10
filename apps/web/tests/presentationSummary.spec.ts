import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { executeOrder, init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { normalizeCommsFrom } from '@/utils/commsEntity'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { summarizeTurn } from '@/utils/turnSummary'
import { playDevelopAnimation, startBattleAnimation } from '@/utils/troopAnimation'
import fixture from './fixtures/live-play-step-5.json'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({
  sendTelegram: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))

function setup() {
  const store = useGameStore()
  store.isReplaying = false
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(
    Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
      type: 'Feature',
      properties: { gb, name: store.cities[gb]!.name },
      geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
    })),
    'gb',
  )
  resetBattleRuntime()
  init({} as never, undefined as never, {} as never)
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
  vi.clearAllMocks()
  return store
}
beforeEach(setup)

async function minorBatch(presentation: 'full' | 'fast') {
  const store = setup()
  const scheduler = useGameScheduler()
  const startIndex = store.eventLog.length
  for (const order of fixture.minorBatch.orders) {
    scheduler.submit([order as GameOrder], {
      authority: 'faction',
      actor: normalizeCommsFrom(order.actor) as Owner,
      presentation,
    })
  }
  await scheduler.advance()
  expect(scheduler.executionResults.value.every((r) => r.ok)).toBe(true)
  return {
    snapshot: store.getSnapshot(),
    events: JSON.parse(JSON.stringify(store.eventLog.slice(startIndex))) as GameEvent[],
    animations: vi.mocked(playDevelopAnimation).mock.calls.length,
  }
}

describe('trusted domestic presentation', () => {
  it('preserves all 25 recorded domestic commands, costs and receipts while removing only their animations', async () => {
    const full = await minorBatch('full')
    const fast = await minorBatch('fast')
    expect(full.animations).toBe(25)
    expect(fast.animations).toBe(0)
    expect(fast.snapshot).toEqual(full.snapshot)
    expect(fast.events).toEqual(full.events)
  })
  it('keeps all four domestic rule paths identical', async () => {
    const orders: GameOrder[] = [
      { order: 'recruit', gb: '156511500', amount: 2 },
      { order: 'develop', gb: '156511500', field: 'industry', amount: 2 },
      { order: 'fortify', gb: '156511500', amount: 2 },
      { order: 'rally', gb: '156511500', amount: 2 },
    ]
    const run = async (presentation: 'full' | 'fast') => {
      const store = setup()
      for (const order of orders)
        expect(
          (await executeOrder(order, { authority: 'faction', actor: Owner.SCC, presentation })).ok,
        ).toBe(true)
      return {
        state: store.getSnapshot(),
        events: JSON.parse(JSON.stringify(store.eventLog)),
        animations: vi.mocked(playDevelopAnimation).mock.calls.length,
      }
    }
    const full = await run('full'),
      fast = await run('fast')
    expect(fast.state).toEqual(full.state)
    expect(fast.events).toEqual(full.events)
    expect([full.animations, fast.animations]).toEqual([4, 0])
  })
  it('cannot be enabled by player authority or a model JSON field', async () => {
    expect(
      (
        await executeOrder(
          { order: 'recruit', gb: '156511500', amount: 1 },
          { authority: 'player', actor: Owner.SCC, presentation: 'fast' },
        )
      ).ok,
    ).toBe(true)
    expect(
      (
        await executeOrder(
          { order: 'fortify', gb: '156511500', amount: 1, presentation: 'fast' } as GameOrder,
          { authority: 'faction', actor: Owner.SCC },
        )
      ).ok,
    ).toBe(true)
    expect(playDevelopAnimation).toHaveBeenCalledTimes(2)
  })
  it('retains ownership, amount, cumulative funds and action-point guards', async () => {
    const store = useGameStore()
    const context = {
      authority: 'faction' as const,
      actor: Owner.SCC,
      presentation: 'fast' as const,
    }
    const before = store.getSnapshot()
    expect((await executeOrder({ order: 'recruit', gb: '156530600', amount: 1 }, context)).ok).toBe(
      false,
    )
    expect(
      (await executeOrder({ order: 'recruit', gb: '156511500', amount: -1 }, context)).ok,
    ).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -500 })
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -500 })
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -197 })
    expect((await executeOrder({ order: 'recruit', gb: '156511500', amount: 1 }, context)).ok).toBe(
      true,
    )
    const paid = store.getSnapshot()
    expect((await executeOrder({ order: 'recruit', gb: '156511500', amount: 1 }, context)).ok).toBe(
      false,
    )
    expect(store.getSnapshot()).toEqual(paid)
    setup()
    for (let i = 0; i < 6; i++)
      expect(
        (await executeOrder({ order: 'recruit', gb: '156511500', amount: 1 }, context)).ok,
      ).toBe(true)
    const exhausted = store.getSnapshot()
    expect((await executeOrder({ order: 'recruit', gb: '156511500', amount: 1 }, context)).ok).toBe(
      false,
    )
    expect(store.getSnapshot()).toEqual(exhausted)
  })
  it('does not remove battle presentation', async () => {
    expect(
      (
        await executeOrder(
          { order: 'battle', from: '156511500', to: '156530600', deployAmount: 6 },
          { authority: 'faction', actor: Owner.SCC, presentation: 'fast' },
        )
      ).ok,
    ).toBe(true)
    expect(startBattleAnimation).toHaveBeenCalledOnce()
  })
})

describe('focused turn summary', () => {
  it('compresses the recorded foreign batch while retaining every original event', async () => {
    const store = useGameStore()
    const before = Object.fromEntries(
      Object.entries(store.cities).map(([gb, city]) => [gb, city.owner]),
    )
    const batch = await minorBatch('fast')
    const economic = buildEconomicTickEvent({
      cities: store.cities,
      activeFactions: store.activeFactions,
      turnCount: store.turnCount,
      getTreasury: (f) => store.getTreasury(f),
      getGranary: (f) => store.getGranary(f),
    })
    const events = [...batch.events, economic]
    const original = JSON.stringify(events)
    const summary = summarizeTurn({
      events,
      player: Owner.SCC,
      cities: store.cities,
      ownershipBefore: before,
    })
    expect(summary.groups.flatMap((g) => g.rows)).toHaveLength(2)
    expect(summary.background.reduce((n, b) => n + b.changes, 0)).toBe(25)
    expect(summary.details).toBe(events)
    expect(JSON.stringify(events)).toBe(original)
  })
  it('uses event-time ownership for domestic changes and keeps a lost city prominent', () => {
    const events: GameEvent[] = [
      { type: 'produce', targetGb: 'z', amount: 2 },
      { type: 'capture', targetGb: 'z', actor: Owner.SCC },
      { type: 'produce', targetGb: 'z', amount: 3 },
      { type: 'capture', targetGb: 'y', actor: Owner.YUN },
      { type: 'produce', targetGb: 'y', amount: 4 },
    ]
    const summary = summarizeTurn({
      events,
      player: Owner.SCC,
      cities: { z: { name: '昭通', owner: Owner.SCC }, y: { name: '宜宾', owner: Owner.YUN } },
      ownershipBefore: { z: Owner.YUN, y: Owner.SCC },
    })
    expect(summary.groups.find((g) => g.key === '军事')?.rows).toHaveLength(2)
    expect(summary.groups.find((g) => g.key === '内政')?.rows.map((r) => r.text)).toEqual([
      '昭通 征兵净+3k',
    ])
    expect(summary.background.find((b) => b.faction === Owner.YUN)?.changes).toBe(2)
  })
  it('aggregates own net resources and troop changes without dropping refusal details', () => {
    const events: GameEvent[] = [
      { type: 'treasuryChange', faction: Owner.SCC, delta: -4 },
      { type: 'treasuryChange', faction: Owner.SCC, delta: 1 },
      { type: 'granaryChange', faction: Owner.SCC, delta: -2 },
      { type: 'produce', targetGb: 'y', amount: 2 },
      { type: 'produce', targetGb: 'y', amount: 3 },
      {
        type: 'commandReceipt',
        faction: Owner.SCC,
        label: '征兵',
        ok: false,
        reason: '粮草不足',
        spentPoints: 0,
        spentSilver: 0,
        spentFood: 0,
        remainingPoints: 4,
        remainingSilver: 100,
        remainingFood: 0,
      },
    ]
    const summary = summarizeTurn({
      events,
      player: Owner.SCC,
      cities: { y: { name: '宜宾', owner: Owner.SCC } },
    })
    const rows = summary.groups.flatMap((g) => g.rows)
    expect(rows.find((r) => r.badge === '本方银')?.text).toContain('净变化-3')
    expect(rows.find((r) => r.badge === '本方粮')?.text).toContain('净变化-2')
    expect(rows.find((r) => r.badge === '征兵')?.text).toContain('+5k')
    expect(rows.find((r) => r.badge === '未执行')).toMatchObject({
      text: '征兵：粮草不足',
      important: true,
    })
  })
})
