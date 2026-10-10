/** Opt-in live decisions after setbacks reached by normal paid orders.
 * No debug resource/ownership writes. Presentation and battle flavor are mocked.
 * MAPWAR_SETBACK_URL=http://127.0.0.1:3002 MAPWAR_SETBACK_OUTPUT=/private/output.json
 * Optional MAPWAR_SETBACK_CASE=budget|unfavorable.
 */
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { decideFaction } from '@/utils/ai/factionAi'
import { buildFactionContext } from '@/utils/aiContext'
import { buildFactionInitiative } from '@/utils/factionInitiative'
import { assessActiveBattle } from '@/utils/tacticalAssessment'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { nextTurnDate } from '@/utils/turnDate'
import { extractPayloads, unwrapData } from '@/utils/aiParse'
import { validateOrders } from '@/utils/aiOrderContract'
vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({ flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const url = process.env.MAPWAR_SETBACK_URL
const output = process.env.MAPWAR_SETBACK_OUTPUT
const filter = process.env.MAPWAR_SETBACK_CASE
const nativeFetch = globalThis.fetch
const cases: object[] = [], requests: object[] = []
const from = '156511500', to = '156530600'
function persist() {
  if (output) writeFileSync(output, JSON.stringify({
    method: 'step-5-preview; normal paid setup/orders; fixed YUN defense; other factions idle; no diplomacy or flavor; not browser gameplay',
    requests, cases,
  }, null, 2))
}
function state() {
  const store = useGameStore()
  return JSON.parse(JSON.stringify({
    date: store.currentDate, turn: store.turnCount,
    silver: store.getTreasury(Owner.SCC), food: store.getGranary(Owner.SCC),
    points: store.getActionPoints(Owner.SCC), source: store.cities[from],
    target: store.cities[to], battles: store.battles,
  }))
}
async function runOrders(orders: GameOrder[], actor = Owner.SCC) {
  const scheduler = useGameScheduler()
  scheduler.submit(orders, { authority: 'faction', actor, presentation: 'fast' })
  await scheduler.advance()
  return JSON.parse(JSON.stringify(scheduler.executionResults.value))
}
describe.skipIf(!url)('real-model tactical setbacks', () => {
  for (const scenario of ['budget', 'unfavorable']) {
    it.skipIf(!!filter && filter !== scenario)(`${scenario}: two fresh decisions`, async () => {
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
      const setup: object[] = [], decisions: object[] = []
      cases.push({ scenario, setup, decisions })
      if (scenario === 'budget') {
        // Spending real starting silver on recruitment creates this stress scene.
        setup.push(await runOrders([
          { order: 'recruit', gb: from, amount: 100 },
          { order: 'recruit', gb: from, amount: 100 },
          { order: 'recruit', gb: from, amount: 100 },
          { order: 'recruit', gb: from, amount: 100 },
          { order: 'recruit', gb: from, amount: 100 },
          { order: 'recruit', gb: from, amount: 99.5 },
        ]))
        assert.equal(store.getTreasury(Owner.SCC), 1)
        // Normal upkeep after over-recruiting leaves a resource setback, not
        // merely exhausted action points. Restore points through a real turn end.
        store.applyEvent(buildEconomicTickEvent({
          cities: store.cities, activeFactions: store.activeFactions, turnCount: store.turnCount,
          getTreasury: f => store.getTreasury(f), getGranary: f => store.getGranary(f),
        }))
        store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
        assert(store.getTreasury(Owner.SCC) < 2)
        assert.equal(store.getActionPoints(Owner.SCC), 6)
        const before = state()
        const refused = await runOrders([{ order: 'recruit', gb: from, amount: 1 }])
        assert.equal(refused[0].ok, false)
        assert.match(refused[0].reason, /银粮不足/)
        assert.deepEqual(state(), before)
        setup.push({ refused, state: state() })
      } else {
        setup.push(await runOrders([
          { order: 'recruit', gb: to, amount: 5 },
          { order: 'fortify', gb: to, amount: 20 },
          { order: 'rally', gb: to, amount: 20 },
        ], Owner.YUN))
        setup.push(await runOrders([{ order: 'battle', from, to, deployAmount: 3 }]))
        const battle = store.battles.find(b => b.active)!
        assert(battle)
        const forecast = assessActiveBattle(battle)
        assert(forecast && forecast.risk !== 'favorable')
        setup.push({ forecast, state: state() })
      }
      persist()
      vi.stubGlobal('fetch', async (_input: unknown, options?: RequestInit) => {
        const started = Date.now()
        const response = await nativeFetch(`${url}/api/ai/chat`, options)
        const raw = await response.clone().json().catch(() => ({}))
        requests.push({ scenario, status: response.status, elapsedMs: Date.now() - started,
          content: raw.choices?.[0]?.message?.content, error: raw.error })
        persist()
        return response
      })
      for (let step = 1; step <= 2; step++) {
        const before = state(), start = store.eventLog.length
        const initiative = buildFactionInitiative(Owner.SCC)
        const context = buildFactionContext(Owner.SCC)
        const requestStart = requests.length
        const decision = await decideFaction(Owner.SCC, context)
        const last = requests.slice(requestStart).at(-1) as { status: number; content?: string }
        const payloads = last?.content
          ? extractPayloads({ choices: [{ message: { content: last.content } }] }) : []
        expect(last?.status).toBe(200)
        expect(payloads.length).toBeGreaterThan(0)
        const planned = payloads.flatMap(p => validateOrders(unwrapData(p)).orders)
        const execution = decision.orders.length ? await runOrders(decision.orders) : []
        const receipts = JSON.parse(JSON.stringify(store.eventLog.slice(start)
          .filter(e => e.type === 'commandReceipt')))
        const afterDecision = state()
        await scheduler.settleActiveBattles()
        store.applyEvent(buildEconomicTickEvent({
          cities: store.cities, activeFactions: store.activeFactions, turnCount: store.turnCount,
          getTreasury: f => store.getTreasury(f), getGranary: f => store.getGranary(f),
        }))
        store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
        decisions.push({ step, before, initiative, planned, approved: decision.orders,
          execution, receipts, afterDecision, afterSettlement: state(),
          events: JSON.parse(JSON.stringify(store.eventLog.slice(start))) })
        expect(store.getActionPoints(Owner.SCC)).toBe(6)
        persist()
        console.log(`${scenario} step=${step} planned=${planned.length} executed=${execution.filter((r: { ok: boolean }) => r.ok).length}`)
      }
      vi.unstubAllGlobals()
    }, 900_000)
  }
})
