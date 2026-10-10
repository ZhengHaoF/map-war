/** Actual model output, offline replay. Not a second live game or latency test. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { useAiOrchestrator } from '@/composables/useAiOrchestrator'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { normalizeCommsFrom } from '@/utils/commsEntity'
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

beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
    type: 'Feature', properties: { gb, name: store.cities[gb]!.name },
    geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
  })), 'gb')
  resetBattleRuntime()
  init({} as never, undefined as never, {} as never)
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
})

async function playerOrders(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn<() => Promise<object>>().mockResolvedValue({
    ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  }))
  const ai = useAiOrchestrator('user')
  ai.userMessage.value = 'Replay actual recorded player request'
  await ai.runSend()
  ai.applyStrategicRules()
  expect(ai.parseError.value).toBeNull()
  const scheduler = useGameScheduler()
  scheduler.submit(ai.getFinalApprovedOrders())
  await scheduler.advance()
  expect(scheduler.executionResults.value.every(r => r.ok)).toBe(true)
}

describe('live-play response regression', () => {
  it('replays recruitment, route cost, capture and consolidation with cumulative balances', async () => {
    const store = useGameStore()
    await playerOrders(fixture.player)
    expect(store.getTreasury(Owner.SCC)).toBe(1181.6)
    expect(store.getGranary(Owner.SCC)).toBe(707.2)
    expect(store.cities['156511500'].troops).toBe(4)
    store.applyEvent(buildEconomicTickEvent({
      cities: store.cities, activeFactions: store.activeFactions, turnCount: store.turnCount,
      getTreasury: f => store.getTreasury(f), getGranary: f => store.getGranary(f),
    }))
    await useGameScheduler().settleActiveBattles()
    expect(store.cities['156530600']).toMatchObject({ owner: Owner.SCC, troops: 5, occupationUntilTurn: 2 })
    await playerOrders(fixture.consolidation)
    expect(store.getTreasury(Owner.SCC)).toBe(1176.9)
    expect(store.getGranary(Owner.SCC)).toBe(890.6)
    expect(store.getActionPoints(Owner.SCC)).toBe(1)
    expect(store.cities['156530600']).toMatchObject({ fort: 25 })
    // Match the live continuation of the saved failed-turn scene, not a fresh
    // economic benchmark: its second settlement preceded the repaired date.
    store.applyEvent(buildEconomicTickEvent({
      cities: store.cities, activeFactions: store.activeFactions, turnCount: store.turnCount,
      getTreasury: f => store.getTreasury(f), getGranary: f => store.getGranary(f),
    }))
    store.applyEvent({ type: 'dateAdvance', date: '1931-04-08' })
    await playerOrders(fixture.followup)
    expect(store.getTreasury(Owner.SCC)).toBe(1182.2)
    expect(store.getGranary(Owner.SCC)).toBe(1081.7)
    expect(store.getActionPoints(Owner.SCC)).toBe(4)
    expect(store.cities['156530600']).toMatchObject({ fort: 28 })
  })
  it('executes the actual 25-order minor batch with independent faction budgets', async () => {
    const store = useGameStore()
    const scheduler = useGameScheduler()
    for (const order of fixture.minorBatch.orders) {
      scheduler.submit([order as GameOrder], { authority: 'faction', actor: normalizeCommsFrom(order.actor) as Owner })
    }
    await scheduler.advance()
    expect(scheduler.executionResults.value).toHaveLength(25)
    expect(scheduler.executionResults.value.filter(r => !r.ok)).toEqual([])
    const receipts = store.eventLog.filter(e => e.type === 'commandReceipt')
    expect(receipts).toHaveLength(25)
    expect(receipts.every(e => e.remainingPoints >= 0 && e.remainingSilver >= 0 && e.remainingFood >= 0)).toBe(true)
    expect(store.getActionPoints(Owner.SCC)).toBe(6)
    expect(store.currentDate).toBe('1931-04-01')
  })
})
