import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { useGameStore } from '@/stores/game'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import type { GameOrder } from '@/utils/gameOrders'
import { useAgentKernel } from '@/composables/useAgentKernel'

const mocks = vi.hoisted(() => ({
  batch: vi.fn<() => Promise<object>>(),
  submit: vi.fn<(orders: GameOrder[], context: object) => void>(),
}))
vi.mock('@/utils/ai', async () => ({
  ...await vi.importActual('@/utils/aiOrderContract'),
  buildMinorContext: () => '',
  runWorldBatch: mocks.batch,
  runWorldSettle: async () => ({ narrative: '', newDate: '1931-04-01', chatter: [] }),
}))
vi.mock('@/utils/aiClassify', () => ({
  classifyFactions: () => ({ related: [], unrelated: [Owner.SCC, Owner.KMT] }),
}))
vi.mock('@/composables/useGameScheduler', () => ({
  useGameScheduler: () => ({
    submit: mocks.submit, advance: async () => {}, settleActiveBattles: async () => {},
  }),
}))
vi.mock('@/composables/useDiplomacyBus', () => ({ useDiplomacyBus: () => ({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const source = '156510100', target = '156511500'
const transfer = {
  order: 'moveTroops', from: source, to: target, amount: 15, actor: OWNER_LABELS[Owner.SCC],
} as GameOrder
const deploy = {
  order: 'deploy', from: target, amount: 15, actor: OWNER_LABELS[Owner.SCC],
} as GameOrder
beforeEach(() => {
  mocks.submit.mockClear()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.YUN)
  store.cities = {
    ...store.cities,
    [source]: { ...store.cities[source]!, troops: 20 },
    [target]: { ...store.cities[target]!, troops: 5 },
  }
  clearLocations()
  registerLocations(Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
    type: 'Feature', properties: { gb, name: store.cities[gb]!.name },
    geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
  })), 'gb')
})
describe('world batch entry point', () => {
  it('preserves interleaved actor order and submits the dependent deployment with trusted identity', async () => {
    const other = { order: 'listBattles', actor: OWNER_LABELS[Owner.KMT] } as GameOrder
    mocks.batch.mockResolvedValue({
      orders: [transfer, other, deploy], errors: [[], [], []], parseSucceeded: true,
    })
    await useAgentKernel().runWorldTurn()
    expect(mocks.submit.mock.calls).toEqual([
      [[transfer], expect.objectContaining({ authority: 'faction', actor: Owner.SCC })],
      [[other], expect.objectContaining({ authority: 'faction', actor: Owner.KMT })],
      [[deploy], expect.objectContaining({ authority: 'faction', actor: Owner.SCC })],
    ])
    expect(useGameStore().cities[target]!.troops).toBe(5) // preflight does not execute
  })
  it('unknown actors, structure errors and enemy ownership cannot create reinforcement dependencies', async () => {
    mocks.batch.mockResolvedValue({
      orders: [
        { ...transfer, actor: '未知势力' }, transfer,
        { ...transfer, actor: OWNER_LABELS[Owner.KMT] }, deploy,
      ],
      errors: [[], ['malformed'], [], []], parseSucceeded: true,
    })
    await useAgentKernel().runWorldTurn()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})
