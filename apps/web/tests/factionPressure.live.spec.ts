/** Opt-in real NPC pressure test, not a full browser or multiplayer model match.
 * Presentation and battle flavor are mocked; actual planning/guards/fees/settlement run.
 * MAPWAR_PRESSURE_URL=http://127.0.0.1:3002 MAPWAR_PRESSURE_OUTPUT=/absolute/report.json
 * Optional MAPWAR_PRESSURE_CASE=defense|counterattack, MAPWAR_PRESSURE_TURNS=12.
 * Bridge authentication is external; never put a key in these variables.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { checkLiveOrder } from '@/utils/gameplayRules'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { decideFaction } from '@/utils/ai/factionAi'
import { buildFactionContext } from '@/utils/aiContext'
import { buildFactionInitiative } from '@/utils/factionInitiative'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { nextTurnDate } from '@/utils/turnDate'
import { SOUTHWEST_SCENARIO } from '@/utils/scenarioObjective'
import { extractPayloads, unwrapData } from '@/utils/aiParse'
import { validateOrders } from '@/utils/aiOrderContract'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
  sendTelegram: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))

const base = process.env.MAPWAR_PRESSURE_URL
const output = process.env.MAPWAR_PRESSURE_OUTPUT
const turns = Number(process.env.MAPWAR_PRESSURE_TURNS ?? 12)
const caseFilter = process.env.MAPWAR_PRESSURE_CASE
const resume = process.env.MAPWAR_PRESSURE_RESUME
const chunk = Number(process.env.MAPWAR_PRESSURE_CHUNK ?? turns)
const nativeFetch = globalThis.fetch
const zhaotong = '156530600',
  yibin = '156511500'
type Scenario = 'defense' | 'counterattack'
interface CallEvidence {
  scenario: Scenario
  turn: number
  status: number
  elapsedMs: number
  content?: string
  finishReason?: string
  error?: unknown
}
interface CaseEvidence {
  scenario: Scenario
  setup: string
  records: object[]
  final: unknown
  checkpoint?: string
}
const previous = resume
  ? (JSON.parse(readFileSync(resume, 'utf8')) as {
      requests: CallEvidence[]
      cases: CaseEvidence[]
    })
  : undefined
const requests: CallEvidence[] = previous?.requests ?? []
const cases: CaseEvidence[] = previous?.cases ?? []
let currentCase: Scenario = 'defense'
function persist() {
  if (output)
    writeFileSync(
      output,
    JSON.stringify(
      {
        plannedTurnsPerCase: turns,
        chunkLimit: chunk,
        coverage: cases.map(c => ({ scenario: c.scenario, completedTurns: c.records.length,
          complete: c.records.length >= turns })),
        method:
            'Actual step-5-preview NPC decisions; fixed SCC controller; actual rules engine. Not native UI gameplay.',
          constraints: [
            '375-city economy retained',
            'other factions idle',
            'no diplomacy settlements',
            'no AI battle flavor',
            'presentation mocked',
            'no extra NPC resources or direct debug capture',
          ],
          requests,
          cases,
        },
        null,
        2,
      ),
    )
}
function reset() {
  vi.unstubAllGlobals()
  const store = useGameStore()
  store.isReplaying = false
  store.initWorld()
  store.selectFaction(Owner.SCC)
  store.applyEvent({ type: 'scenarioStarted', id: SOUTHWEST_SCENARIO, faction: Owner.SCC })
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
  vi.stubGlobal('fetch', async (_url: unknown, options?: RequestInit) => {
    const started = Date.now()
    const res = await nativeFetch(`${base}/api/ai/chat`, options)
    const data = await res
      .clone()
      .json()
      .catch(() => ({}))
    requests.push({
      scenario: currentCase,
      turn: store.turnCount,
      status: res.status,
      elapsedMs: Date.now() - started,
      content: data.choices?.[0]?.message?.content,
      finishReason: data.choices?.[0]?.finish_reason,
      error: data.error,
    })
    persist()
    return res
  })
  return store
}
async function controllerOrders(orders: GameOrder[]) {
  const scheduler = useGameScheduler()
  const legal = orders.filter(
    (order) => checkLiveOrder(order, { authority: 'player', actor: Owner.SCC }).ok,
  )
  if (!legal.length) return []
  scheduler.submit(legal, { authority: 'player', actor: Owner.SCC })
  await scheduler.advance()
  return scheduler.executionResults.value.map((r) => ({
    order: r.order,
    ok: r.ok,
    reason: r.reason,
  }))
}
function tick() {
  const store = useGameStore()
  store.applyEvent(
    buildEconomicTickEvent({
      cities: store.cities,
      activeFactions: store.activeFactions,
      turnCount: store.turnCount,
      getTreasury: (f) => store.getTreasury(f),
      getGranary: (f) => store.getGranary(f),
    }),
  )
}
async function fixedController() {
  const store = useGameStore()
  const held = store.cities[zhaotong]!.owner === Owner.SCC
  if (held)
    return controllerOrders([
      { order: 'recruit', gb: zhaotong, amount: 2 },
      { order: 'fortify', gb: zhaotong, amount: Math.min(5, 100 - store.cities[zhaotong]!.fort) },
    ])
  const front = store.battles.find((b) => b.active && b.attacker === Owner.SCC)
  if (front)
    return controllerOrders([
      { order: 'recruit', gb: front.from, amount: 3 },
      {
        order: 'deploy',
        from: front.from,
        amount: Math.min(2, Math.max(0, store.cities[front.from]!.troops - 2)),
      },
    ])
  if (store.cities[yibin]!.owner === Owner.SCC) {
    if (store.cities[yibin]!.troops >= 8)
      return controllerOrders([{ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 }])
    return controllerOrders([{ order: 'recruit', gb: yibin, amount: 3 }])
  }
  return controllerOrders(buildFactionInitiative(Owner.SCC).examples.slice(0, 2))
}
function state() {
  const store = useGameStore()
  return {
    date: store.currentDate,
    turn: store.turnCount,
    objective: store.scenarioStatus,
    cities: [yibin, zhaotong].map((gb) => ({ ...store.cities[gb] })),
    scc: {
      silver: store.getTreasury(Owner.SCC),
      food: store.getGranary(Owner.SCC),
      points: store.getActionPoints(Owner.SCC),
    },
    yun: {
      silver: store.getTreasury(Owner.YUN),
      food: store.getGranary(Owner.YUN),
      points: store.getActionPoints(Owner.YUN),
    },
    battles: store.battles.map((b) => ({ ...b })),
  }
}

describe.skipIf(!base)('actual faction pressure', () => {
  for (const scenario of ['defense', 'counterattack'] as Scenario[]) {
    it.skipIf(!!caseFilter && caseFilter !== scenario)(
      `${scenario}: target ${turns} NPC turns, chunk ${chunk}`,
      async () => {
        currentCase = scenario
        expect(turns).toBeGreaterThanOrEqual(10)
        expect(turns).toBeLessThanOrEqual(15)
        const store = reset()
        const scheduler = useGameScheduler()
        const restored = cases.find((c) => c.scenario === scenario)
        const records: object[] = restored?.records ?? []
        const result: CaseEvidence = restored ?? { scenario, setup: '', records, final: {} }
        if (!restored) cases.push(result)
        if (restored?.checkpoint) {
          localStorage.setItem('mapwar_save_pressure', restored.checkpoint)
          if (!store.load('pressure')) throw new Error('Pressure checkpoint could not be loaded')
          store.isReplaying = false // No map component in this engine-only harness.
        } else {
          await controllerOrders([
            { order: 'recruit', gb: yibin, amount: 2 },
            { order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 },
          ])
          if (scenario === 'counterattack') {
            // Initial NPC deliberately idle ONLY in this documented setup. Capture
            // comes from the actual battle formula, not fabricated ownership writes.
            tick()
            await scheduler.settleActiveBattles()
            store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
            result.setup =
              'Normal engine-settled opening capture; NPC idle during setup, then real model responses.'
          } else
            result.setup = 'Normal opening active SCC attack; NPC responds before first settlement.'
          if (
            store.cities[zhaotong]!.owner !== (scenario === 'counterattack' ? Owner.SCC : Owner.YUN)
          )
            throw new Error('Normal pressure opening did not reach the expected owner')
        }
      expect(restored && restored.records.length ? state() : null)
        .toEqual(restored && restored.records.length ? restored.final : null)
      const checkpoint = () => {
        expect(store.save('pressure')).toBe(true)
        result.final = state()
        result.checkpoint = localStorage.getItem('mapwar_save_pressure')!
          persist()
        }
        checkpoint()
        const startStep = records.length
        for (let step = startStep; step < Math.min(turns, startStep + chunk); step++) {
          const startIdx = store.eventLog.length,
            requestIdx = requests.length
          const controller = scenario === 'defense' && step === 0 ? [] : await fixedController()
          tick()
          const initiative = buildFactionInitiative(Owner.YUN)
          let approved: GameOrder[] = [],
            error: string | undefined
          try {
            const decision = await decideFaction(Owner.YUN, buildFactionContext(Owner.YUN))
            approved = decision.orders
          } catch (err) {
            error = err instanceof Error ? err.message : '请求失败'
          }
          // Do not silently turn transport failure into an idle "real model turn".
          // Preserve the request, then resume from the last completed normal save.
          if (error) {
            persist()
            throw new Error(`Pressure paused before step ${step + 1}: ${error}`)
          }
          const planningRefusals = store.eventLog
            .slice(startIdx)
            .filter((e) => e.type === 'commandReceipt' && e.faction === Owner.YUN)
          if (approved.length) {
            scheduler.submit(approved, {
              authority: 'faction',
              actor: Owner.YUN,
              presentation: 'fast',
            })
            await scheduler.advance()
          }
          const execution = approved.length
            ? scheduler.executionResults.value.map((r) => ({
                order: r.order,
                ok: r.ok,
                reason: r.reason,
                cost: r.cost,
              }))
            : []
          await scheduler.settleActiveBattles()
          store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
          const calls = requests.slice(requestIdx)
          const lastContent = calls.filter((c) => c.status === 200).at(-1)?.content
          const payloads = lastContent
            ? extractPayloads({ choices: [{ message: { content: lastContent } }] })
            : []
          const batches = payloads.map((p) => validateOrders(unwrapData(p)))
          const receipts = store.eventLog
            .slice(startIdx)
            .filter(
              (e): e is Extract<GameEvent, { type: 'commandReceipt' }> =>
                e.type === 'commandReceipt' && e.faction === Owner.YUN,
            )
          const record = {
            step: step + 1,
            initiative,
            controller,
            parseSucceeded: payloads.length > 0,
            plannedOrders: batches.flatMap((b) => b.orders),
            planningRefusals,
            approved,
            execution,
            error,
            calls: calls.length,
            receipts,
            events: store.eventLog.slice(startIdx),
            state: state(),
          }
          records.push(record)
          expect(store.getActionPoints(Owner.YUN)).toBe(6)
          expect(receipts.every((r) => r.remainingPoints >= 0 && r.spentPoints >= 0)).toBe(true)
          expect(
            approved.every(
              (o) =>
                !['capture', 'setFactionAlive', 'setCurrentDate', 'setCurrentFaction'].includes(
                  o.order,
                ),
            ),
          ).toBe(true)
          result.final = state()
          checkpoint()
          console.log(
            `${scenario} step=${step + 1} goal=${initiative.kind} approved=${approved.length} executed=${execution.filter((r) => r.ok).length} failure=${error ?? 'none'} zhaotong=${store.cities[zhaotong]!.owner}`,
          )
        }
        expect(requests.some((c) => c.scenario === scenario && c.status === 200 && c.content)).toBe(
          true,
        )
        persist()
      },
      900_000,
    )
  }
})
