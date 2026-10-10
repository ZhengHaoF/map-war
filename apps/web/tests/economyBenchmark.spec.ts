/** Offline integration benchmark. Uses real guards/reducers/settlement, not an LLM. */
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { CITY_CONNECTION_NODES, getCityNeighbours } from '@/utils/campaignRoutes'
import { getAttackableTargets } from '@/utils/campaignPreview'
import { computeFactionEconomy } from '@/utils/economy'
import { checkLiveOrder } from '@/utils/gameplayRules'
import { executeOrder, init, resetBattleRuntime, type GameOrder } from '@/utils/gameOrders'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { nextTurnDate } from '@/utils/turnDate'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { economyOutlook } from '@/utils/economyOutlook'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => { graphics: object; stop: () => void }>(() => ({
    graphics: {},
    stop: () => {},
  })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))

type Policy = 'idle' | 'recruit-rush' | 'reserve-aware' | 'food-shock'
interface Metric {
  policy: Policy
  seed: number
  turn: number
  faction: Owner
  cities: number
  troops: number
  fieldForce: number
  treasury: number
  granary: number
  silverNet: number
  foodNet: number
  morale: number
  activeBattles: number
  startedBattles: number
  captures: number
  attempts: number
  rejected: number
  pointsSpent: number
  capacity: number
  arrear: boolean
  famine: boolean
  goal: string
}
const round = (n: number) => Math.round(n * 10) / 10
function rank(gb: string, seed: number) {
  let hash = seed >>> 0
  for (const c of gb) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0
  return hash
}
async function simulate(policy: Policy, seed: number, turns: number): Promise<Metric[]> {
  setActivePinia(createPinia())
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  resetBattleRuntime()
  init({} as never, undefined as never, {} as never)
  clearLocations()
  registerLocations(
    Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
      type: 'Feature' as const,
      properties: { gb, name: store.cities[gb]!.name },
      geometry: { type: 'Point' as const, coordinates: [node.lng, node.lat] },
    })),
    'gb',
  )
  const factions = [...store.activeFactions].filter((f) => f !== Owner.NEUTRAL).sort()
  if (policy === 'food-shock') {
    // Explicit severe stress fixture, not a normal scenario or a model-generated event.
    for (const city of Object.values(store.cities)) {
      while (store.cities[city.gb]!.food > 0)
        store.applyEvent({
          type: 'cityStatChange',
          targetGb: city.gb,
          field: 'food',
          delta: -Math.min(10, store.cities[city.gb]!.food),
        })
    }
    for (const faction of factions) {
      // Respect reducer delta caps; a single large negative event is clamped.
      while (store.getGranary(faction) > 0)
        store.applyEvent({
          type: 'granaryChange',
          faction,
          delta: -Math.min(100, store.getGranary(faction)),
        })
      const city = Object.values(store.cities)
        .filter((c) => c.owner === faction)
        .sort((a, b) => b.troops - a.troops)[0]!
      store.applyEvent({ type: 'deploy', fromGb: city.gb, amount: Math.min(10, city.troops) })
    }
  }
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
  const output: Metric[] = []
  for (let turn = 1; turn <= turns; turn++) {
    // Exact production ordering: economy, actions, battle settlement, date advance.
    const economicEvent = buildEconomicTickEvent(store)
    // Optional replay of baseline rules makes before/after reproducible after release.
    if (process.env.MAPWAR_BENCHMARK_LEGACY === '1') delete economicEvent.attritionVersion
    const entries = economicEvent.entries
    store.applyEvent(economicEvent)
    const start = store.eventLog.length
    const counts = new Map<
      Owner,
      { attempts: number; rejected: number; goal: string; capacity: number }
    >()
    const ordered = [...factions].sort((a, b) => rank(a, seed + turn) - rank(b, seed + turn))
    for (const faction of ordered) {
      const record = {
        attempts: 0,
        rejected: 0,
        goal: policy === 'idle' || policy === 'food-shock' ? '等待' : '征兵',
        capacity: store.activeFactions.includes(faction) ? store.getActionPoints(faction) : 0,
      }
      counts.set(faction, record)
      if (!record.capacity || policy === 'idle' || policy === 'food-shock') continue
      for (
        let slot = 0;
        slot < Math.min(record.capacity, policy === 'reserve-aware' ? 3 : 6);
        slot++
      ) {
        const own = Object.values(store.cities)
          .filter((c) => c.owner === faction)
          .sort((a, b) => b.troops - a.troops || rank(a.gb, seed) - rank(b.gb, seed))
        if (!own.length || store.gameOver?.ended) break
        const eco = computeFactionEconomy(store.cities, faction, store.turnCount)
        const outlook = economyOutlook(
          store.cities,
          faction,
          store.turnCount,
          store.getTreasury(faction),
          store.getGranary(faction),
        )
        const silverReserve = Math.max(10, outlook.reserveSilver)
        const foodReserve = Math.max(10, outlook.reserveFood)
        let order: GameOrder | undefined
        if (policy === 'recruit-rush') order = { order: 'recruit', gb: own[0]!.gb, amount: 5 }
        else if (eco.silverNet < 0 || eco.foodNet < 0) {
          record.goal = eco.foodNet < 0 ? '保粮' : '补税'
          const field = eco.foodNet < 0 ? 'food' : 'industry'
          const city = [...own]
            .filter((c) => c[field] < 100)
            .sort((a, b) => a[field] - b[field] || rank(a.gb, seed) - rank(b.gb, seed))[0]
          if (city && store.getTreasury(faction) > 15)
            order = {
              order: 'develop',
              gb: city.gb,
              field,
              amount: Math.min(10, 100 - city[field]),
            }
        } else {
          record.goal = '扩张'
          const source = own
            .filter(
              (c) =>
                c.troops >= 2 &&
                !store.battles.some((b) => b.active && b.from === c.gb) &&
                getCityNeighbours(c.gb).some((gb) => store.cities[gb]?.owner !== faction),
            )
            .slice(0, 4)
          const attacks = source
            .flatMap((c) => getAttackableTargets(c.gb, Math.min(10, c.troops), faction))
            .filter(
              (p) =>
                p.supply?.supplied &&
                p.fightingTroops! >= Math.max(2, store.cities[p.targetGb]!.troops * 1.5) &&
                store.getTreasury(faction) - p.silver! >= silverReserve &&
                store.getGranary(faction) - p.food! >= foodReserve,
            )
            .sort(
              (a, b) => a.silver! - b.silver! || rank(a.targetGb, seed) - rank(b.targetGb, seed),
            )
          if (attacks[0]) order = attacks[0].order
          else {
            record.goal = '整备'
            const city = own.find((c) => c.morale < 60)
            if (city)
              order = { order: 'rally', gb: city.gb, amount: Math.min(10, 70 - city.morale) }
            else if (
              store.getTreasury(faction) > silverReserve + 10 &&
              store.getGranary(faction) > foodReserve + 5 &&
              outlook.recruitLimit >= 5
            )
              order = { order: 'recruit', gb: own[0]!.gb, amount: 5 }
          }
        }
        if (!order) break
        // Rush deliberately attempts unaffordable recruitment to measure rejection;
        // reserve-aware preflights and safely idles when no order is affordable.
        if (
          policy === 'reserve-aware' &&
          !checkLiveOrder(order, { actor: faction, authority: 'faction' }).ok
        )
          break
        record.attempts++
        const result = await executeOrder(order, { actor: faction, authority: 'faction' })
        if (!result.ok) {
          record.rejected++
          break
        }
      }
    }
    await scheduler.settleActiveBattles()
    const events = store.eventLog.slice(start)
    for (const faction of factions) {
      const own = Object.values(store.cities).filter((c) => c.owner === faction)
      const eco = computeFactionEconomy(store.cities, faction, store.turnCount)
      const record = counts.get(faction)!
      output.push({
        policy,
        seed,
        turn,
        faction,
        cities: own.length,
        troops: round(eco.totalTroops),
        fieldForce: round(own.reduce((s, c) => s + c.fieldForce, 0)),
        treasury: store.getTreasury(faction),
        granary: store.getGranary(faction),
        silverNet: eco.silverNet,
        foodNet: eco.foodNet,
        morale: own.length ? round(own.reduce((s, c) => s + c.morale, 0) / own.length) : 0,
        activeBattles: store.battles.filter(
          (b) => b.active && (b.attacker === faction || b.defender === faction),
        ).length,
        startedBattles: events.filter((e) => e.type === 'battleStart' && e.attacker === faction)
          .length,
        captures: events.filter((e) => e.type === 'capture' && e.actor === faction).length,
        attempts: record.attempts,
        rejected: record.rejected,
        goal: record.goal,
        pointsSpent: events.reduce(
          (s, e) => s + (e.type === 'actionSpent' && e.faction === faction ? e.amount : 0),
          0,
        ),
        capacity: record.capacity,
        arrear: !!entries.find((e) => e.faction === faction)?.arrear,
        famine: !!entries.find((e) => e.faction === faction)?.famine,
      })
    }
    store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
  }
  return output
}
describe('offline economy and strategy benchmark', () => {
  it('reproduces identical results for identical policy, seed and turns', async () => {
    expect(await simulate('reserve-aware', 1931, 3)).toEqual(
      await simulate('reserve-aware', 1931, 3),
    )
  }, 60_000)
  it('can run and export forty-turn scenario matrices when explicitly requested', async () => {
    if (!process.env.MAPWAR_BENCHMARK_OUT) return
    const rows: Metric[] = []
    for (const policy of ['idle', 'recruit-rush', 'reserve-aware', 'food-shock'] as const)
      for (const seed of policy === 'food-shock' ? [1931] : [1931, 1942, 2026])
        rows.push(...(await simulate(policy, seed, 40)))
    expect(rows).toHaveLength(10 * 40 * 12)
    expect(
      rows.every((r) =>
        [r.troops, r.treasury, r.granary, r.silverNet, r.foodNet, r.morale].every(Number.isFinite),
      ),
    ).toBe(true)
    const folder = resolve(process.env.MAPWAR_BENCHMARK_OUT)
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      resolve(folder, 'economy-benchmark.json'),
      JSON.stringify(
        {
          methodology:
            'Deterministic scripted policies; real game guards, events, costs and battle settlement; no LLM flavor/diplomacy/world events. Seeds rotate faction order and break ties, not statistical independent samples.',
          labels: OWNER_LABELS,
          rows,
        },
        null,
        2,
      ),
    )
    const keys = Object.keys(rows[0]!) as (keyof Metric)[]
    writeFileSync(
      resolve(folder, 'economy-benchmark.csv'),
      keys.join(',') +
        '\n' +
        rows.map((r) => keys.map((k) => String(r[k])).join(',')).join('\n') +
        '\n',
    )
    console.log(`Exported ${rows.length} faction-turn rows to ${folder}`)
  }, 300_000)
})
