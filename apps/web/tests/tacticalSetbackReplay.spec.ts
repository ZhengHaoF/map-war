/** Normalized orders from actual responses, offline replay; NOT more live samples. */
import { describe, expect, it, vi } from 'vitest'
import evidence from '../../../docs/fixtures/tactical-setbacks.json'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { decideFaction } from '@/utils/ai/factionAi'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { nextTurnDate } from '@/utils/turnDate'
vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({ flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const from = '156511500', to = '156530600'
function state() {
  const store = useGameStore()
  return JSON.parse(JSON.stringify({
    date: store.currentDate, turn: store.turnCount,
    silver: store.getTreasury(Owner.SCC), food: store.getGranary(Owner.SCC),
    points: store.getActionPoints(Owner.SCC), source: store.cities[from],
    target: store.cities[to], battles: store.battles,
  }))
}
function endTurn() {
  const store = useGameStore()
  store.applyEvent(buildEconomicTickEvent({
    cities: store.cities, activeFactions: store.activeFactions, turnCount: store.turnCount,
    getTreasury: f => store.getTreasury(f), getGranary: f => store.getGranary(f),
  }))
  store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
}
async function run(orders: GameOrder[], actor = Owner.SCC) {
  const scheduler = useGameScheduler()
  scheduler.submit(orders, { authority: 'faction', actor, presentation: 'fast' })
  await scheduler.advance()
  return JSON.parse(JSON.stringify(scheduler.executionResults.value))
}
type RecordedDecision = (typeof evidence.runs)[number]['cases'][number]['decisions'][number]
async function verifyFixedRecordedPlan(recorded: RecordedDecision, orders: GameOrder[], start: number) {
  const store = useGameStore()
  // Keep historical evidence immutable. This is a new offline execution,
  // not another live model sample or a relabelled historical settlement.
  expect(recorded.approved).toHaveLength(1)
  expect(recorded.receipts[0]?.reason).toContain('战略预检拒绝')
  expect(orders).toEqual(recorded.planned)
  expect(store.eventLog).toHaveLength(start)
  expect(await run(orders)).toEqual([
    ...recorded.execution,
    { order: recorded.planned[1], ok: true },
  ])
  const receipts = store.eventLog.slice(start).filter(e => e.type === 'commandReceipt')
  expect(receipts).toHaveLength(2)
  expect(receipts[0]).toEqual(recorded.receipts[1])
  expect(receipts[1]).toMatchObject({
    ok: true, spentPoints: 1, spentSilver: 0, spentFood: 0,
    remainingPoints: 3, remainingSilver: 1109.9, remainingFood: 652.5,
  })
  expect(state()).toEqual({
    ...recorded.afterDecision,
    points: 3,
    source: { ...recorded.afterDecision.source, troops: 5, fieldForce: 18 },
  })
  // New troop levels intentionally change combat; only check turn advancement here.
  await useGameScheduler().settleActiveBattles()
  endTurn()
  expect(store.currentDate).toBe(recorded.afterSettlement.date)
  expect(store.turnCount).toBe(recorded.afterSettlement.turn)
  expect(store.getActionPoints(Owner.SCC)).toBe(6)
}
describe('actual setback order regression (offline)', () => {
  for (const item of evidence.runs.flatMap(r => r.cases.map(sample => ({ run: r.run, sample })))
    .filter(item => item.sample.validDecisions > 0)) {
    it(`run ${item.run} ${item.sample.scenario}: replays recorded plans (run 2 explicitly verifies the fix)`, async () => {
      vi.unstubAllGlobals()
      const store = useGameStore()
      store.isReplaying = false
      store.initWorld()
      store.selectFaction(Owner.SCC)
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
      const setup = item.sample.setup
      const first = setup[0] as { order: GameOrder }[]
      await run(first.map(r => r.order), item.sample.scenario === 'budget' ? Owner.SCC : Owner.YUN)
      if (item.sample.scenario === 'budget') {
        endTurn()
        await run((setup[1] as { refused: { order: GameOrder }[] }).refused.map(r => r.order))
      } else await run((setup[1] as { order: GameOrder }[]).map(r => r.order))
      for (const recorded of item.sample.decisions) {
        expect(state()).toEqual(recorded.before)
        const start = store.eventLog.length
        // Preserve the model's parsed orders, not fabricated successful receipts.
        vi.stubGlobal('fetch', vi.fn<() => Promise<object>>().mockResolvedValue({
          ok: true, json: async () => ({ choices: [{
            message: { content: JSON.stringify({ orders: recorded.planned }) },
          }] }),
        }))
        const decision = await decideFaction(Owner.SCC, 'Offline recorded-order replay, not a live decision')
        if (item.run === 2 && item.sample.scenario === 'unfavorable') {
          await verifyFixedRecordedPlan(recorded, decision.orders, start)
          continue
        }
        expect(decision.orders).toEqual(recorded.approved)
        const execution = decision.orders.length ? await run(decision.orders) : []
        expect(execution).toEqual(recorded.execution)
        expect(store.eventLog.slice(start).filter(e => e.type === 'commandReceipt')).toEqual(recorded.receipts)
        expect(state()).toEqual(recorded.afterDecision)
        await scheduler.settleActiveBattles()
        endTurn()
        expect(state()).toEqual(recorded.afterSettlement)
      }
      vi.unstubAllGlobals()
    })
  }
})
