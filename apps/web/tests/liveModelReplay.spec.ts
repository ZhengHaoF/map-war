/** Opt-in replay of actual provider responses through the production command pipeline.
 * MAPWAR_LLM_REPLAY=/absolute/path/output.json pnpm --filter warlords-1931-web exec vitest run tests/liveModelReplay.spec.ts
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, executeOrder } from '@/utils/gameOrders'
import { useAiOrchestrator } from '@/composables/useAiOrchestrator'
import raw from '@/data/chinaCities.seed.json'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => { graphics: object; stop: () => void }>(() => ({ graphics: {}, stop: vi.fn<() => void>() })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/cloudTransition', () => ({ playCloudTransition: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }))
vi.mock('@/utils/ai', () => ({ sendTelegram: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]) }))

interface Scenario { id: string; points: number; truce?: boolean; raw: unknown }
const fixture = process.env.MAPWAR_LLM_REPLAY
const data = fixture ? JSON.parse(readFileSync(fixture, 'utf8')) : null
const scenarios: Scenario[] = data?.scenarios ?? []

beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(raw.filter(c => c.gb).map((c, i) => ({
    type: 'Feature', properties: { name: c.name, gb: c.gb },
    geometry: { type: 'Point', coordinates: [100 + i / 1000, 30] },
  })) as any, 'gb')
  resetBattleRuntime()
  init({} as any, undefined as any, {} as any)
})

describe.skipIf(!fixture)('actual provider response replay', () => {
  it.each(scenarios)('$id passes hard-rule assertions', async scenario => {
    const store = useGameStore()
    const home = store.cities[data.locations.homeGb]!
    const enemy = store.cities[data.locations.enemyGb]!
    if (scenario.points === 0) store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: 6 })
    if (scenario.truce) store.applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.KMT, status: 'peace', truceUntil: '1932-01-01' })
    const before = { silver: store.getTreasury(Owner.SCC), troops: home.troops, relation: store.relationBetween(Owner.SCC, Owner.KMT) }
    vi.stubGlobal('fetch', vi.fn<() => Promise<object>>().mockResolvedValue({ ok: true, json: async () => scenario.raw }))
    const agent = useAiOrchestrator('user')
    agent.userMessage.value = scenario.id
    await agent.runSend()
    agent.applyStrategicRules()
    for (const order of agent.getFinalApprovedOrders()) await executeOrder(order)
    expect(agent.parseError.value).toBeNull()
    expect(store.currentDate).toBe('1931-04-01')
    expect(store.cities[enemy.gb].owner).toBe(Owner.KMT)
    expect(store.getActionPoints(Owner.SCC)).toBeGreaterThanOrEqual(0)
    expect(store.cities[home.gb].troops).toBe(before.troops + (scenario.id === 'normal-recruit' ? 1 : 0))
    expect(store.battles).toHaveLength(0)
    expect(store.relationBetween(Owner.SCC, Owner.KMT)).toEqual(before.relation)
    expect(store.getTreasury(Owner.SCC)).toBeLessThanOrEqual(before.silver + 50)
  })
})
