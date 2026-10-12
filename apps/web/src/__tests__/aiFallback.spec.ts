import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Owner } from '@/data/owners'
import { useGameStore } from '@/stores/game'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { aiStatusText, type AiStatus } from '@/utils/aiStatus'
import { buildEventHistory } from '@/utils/aiHistory'
import TurnSummaryModal from '@/components/TurnSummaryModal.vue'
import { runWorldSettle } from '@/utils/ai/worldAi'
import { flavorBattles } from '@/utils/ai/battleFlavorAi'
import { decideFaction } from '@/utils/ai/factionAi'
import type { BattleInfo } from '@/stores/game'
import type { BaseResult } from '@/utils/battleFormula'
import type { GameOrder } from '@/utils/gameOrders'

const mocks = vi.hoisted(() => ({
  faction: vi.fn<() => Promise<object>>(), batch: vi.fn<() => Promise<object>>(),
  settle: vi.fn<() => Promise<object>>(), call: vi.fn<() => Promise<unknown>>(),
  invoke: vi.fn<() => Promise<object>>(), toast: vi.fn<(value: unknown) => void>(),
  submit: vi.fn<(orders: GameOrder[], context: object) => void>(),
  advance: vi.fn<() => Promise<void>>(),
}))
vi.mock('@/utils/ai', async () => ({
  ...await vi.importActual('@/utils/aiOrderContract'),
  buildFactionContext: () => '', buildMinorContext: () => '',
  decideFaction: mocks.faction, runWorldBatch: mocks.batch, runWorldSettle: mocks.settle,
}))
vi.mock('@/utils/ai/client', () => ({ callLlm: mocks.call }))
vi.mock('@/utils/ai/invoke', () => ({ invokeAgentDecision: mocks.invoke }))
vi.mock('@/utils/aiClassify', () => ({
  classifyFactions: () => ({ related: [Owner.YUN], unrelated: [Owner.KMT, Owner.NEA] }),
}))
vi.mock('@/composables/useGameScheduler', async () => {
  const { ref } = await import('vue')
  return { useGameScheduler: () => ({ submit: mocks.submit, advance: mocks.advance,
    settleActiveBattles: async () => {},
    status: ref('idle'), queue: ref([]), stoppedAt: ref(null), executionResults: ref([]),
    // 契约桩：提交记录即队列（advance 会消费 submit 记录），暂停/恢复不在本文件覆盖
    detachQueue: () => [],
    restoreQueue: (entries: { order: GameOrder; context: object }[]) => {
      for (const e of entries) mocks.submit([e.order], e.context)
    } }) }
})
vi.mock('@/composables/useDiplomacyBus', () => ({ useDiplomacyBus: () => ({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: mocks.toast }) }))
const raw = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] })
beforeEach(() => {
  vi.clearAllMocks()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  mocks.faction.mockResolvedValue({ orders: [] })
  mocks.batch.mockResolvedValue({ orders: [], errors: [], parseSucceeded: true })
  mocks.settle.mockResolvedValue({ narrative: '正常叙事', newDate: '1931-04-08', chatter: [], aiStatus: { status: 'ok' } })
  mocks.advance.mockImplementation(async () => {
    for (const [orders] of mocks.submit.mock.calls.splice(0)) {
      for (const o of orders) if (o.order === 'setCurrentDate')
        store.applyEvent({ type: 'dateAdvance', date: o.date! })
    }
  })
})
const statuses = () => useGameStore().eventLog.filter((e): e is AiStatus => e.type === 'aiStatus')
describe('world turn degradation ledger', () => {
  it('records failed faction and batch separately, settles economy/date once and warns', async () => {
    mocks.faction.mockRejectedValue(new Error('provider details should not be saved'))
    mocks.batch.mockRejectedValue(new Error('401'))
    await useAgentKernel().endPlayerTurn()
    expect(statuses()).toEqual([
      { type: 'aiStatus', phase: 'faction', factions: [Owner.YUN], status: 'failed', reason: 'request' },
      { type: 'aiStatus', phase: 'batch', factions: [Owner.KMT, Owner.NEA], status: 'failed', reason: 'request' },
      { type: 'aiStatus', phase: 'settlement', factions: [], status: 'ok' },
    ])
    const store = useGameStore()
    expect(store.currentDate).toBe('1931-04-08')
    expect(store.turnCount).toBe(1)
    expect(store.eventLog.filter(e => e.type === 'economicTick')).toHaveLength(1)
    expect(store.eventLog.filter(e => e.type === 'dateAdvance')).toHaveLength(1)
    expect(JSON.stringify(statuses())).not.toContain('provider details')
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: '回合结束（AI 降级）' }))
    expect(buildEventHistory()).toContain('决策缺失，不代表主动按兵不动')
  })
  it('valid empty decisions remain distinguishable and do not produce a warning', async () => {
    await useAgentKernel().endPlayerTurn()
    expect(statuses().map(e => e.status)).toEqual(['empty', 'empty', 'ok'])
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: '回合结束', tone: 'green' }))
  })
  it('marks unparseable batch and faction responses instead of voluntary inactivity', async () => {
    mocks.faction.mockResolvedValue({ orders: [], decisionStatus: { status: 'failed', reason: 'format' } })
    mocks.batch.mockResolvedValue({ orders: [], errors: [], parseSucceeded: false })
    await useAgentKernel().endPlayerTurn()
    expect(statuses().slice(0, 2).every(e => e.status === 'failed' && e.reason === 'format')).toBe(true)
  })
  it('marks filtered batch plans and only submits accepted orders', async () => {
    mocks.batch.mockResolvedValue({ orders: [{ order: 'recruit', gb: 'bad', actor: '未知' }],
      errors: [['bad']], parseSucceeded: true })
    await useAgentKernel().endPlayerTurn()
    expect(statuses()).toContainEqual(expect.objectContaining({ phase: 'batch', status: 'partial', reason: 'filtered' }))
  })
  it('persists the advisory ledger without changing balances during replay', async () => {
    const store = useGameStore()
    const before = store.getSnapshot()
    const status: AiStatus = { type: 'aiStatus', phase: 'faction', factions: [Owner.YUN], status: 'failed', reason: 'request' }
    store.applyEvent(status)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.save('ledger')).toBe(true)
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -10 })
    expect(store.load('ledger')).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.eventLog).toContainEqual(status)
  })
  it('shows a persistent warning and missing faction name in the summary', () => {
    const event: AiStatus = { type: 'aiStatus', phase: 'faction', factions: [Owner.YUN], status: 'failed', reason: 'request' }
    const wrapper = mount(TurnSummaryModal, { props: { visible: true, events: [event] },
      global: { stubs: { GameModal: { template: '<div><slot /></div>' } } } })
    expect(wrapper.get('[role="alert"]').text()).toContain('AI 降级')
    expect(wrapper.text()).toContain('滇系决策')
    expect(wrapper.text()).toContain('不自动重跑')
    wrapper.unmount()
  })
  it('does not show a degradation banner for successful empty decisions', () => {
    const event: AiStatus = { type: 'aiStatus', phase: 'faction', factions: [Owner.YUN], status: 'empty' }
    const wrapper = mount(TurnSummaryModal, { props: { visible: true, events: [event] },
      global: { stubs: { GameModal: { template: '<div><slot /></div>' } } } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(aiStatusText(event)).toContain('有效回复，无行动计划')
    wrapper.unmount()
  })
  it('prevents two end-turn calls while the first is in flight', async () => {
    let resolve!: (value: object) => void
    mocks.faction.mockImplementation(() => new Promise(r => { resolve = r }))
    const first = useAgentKernel().endPlayerTurn()
    await vi.waitFor(() => expect(mocks.faction).toHaveBeenCalled())
    await useAgentKernel().endPlayerTurn()
    resolve({ orders: [] })
    await first
    expect(useGameStore().eventLog.filter(e => e.type === 'economicTick')).toHaveLength(1)
  })
})
describe('fallback modules', () => {
  it.each(['request', 'format'] as const)('reports settlement %s failure and deterministic next date', async reason => {
    if (reason === 'request') mocks.call.mockRejectedValue(new Error('offline'))
    else mocks.call.mockResolvedValue(raw({ newDate: '1931-04-30', chatter: [{ from: 'x', content: 'fake' }] }))
    const result = await runWorldSettle('1931-04-01')
    expect(result.aiStatus).toEqual({ status: 'failed', reason })
    expect(result.newDate).toBe('1931-04-08')
    expect(result.chatter).toEqual([])
    expect(result.narrative).toContain('未取得有效回复')
  })
  it('valid settlement narrative does not get marked degraded', async () => {
    mocks.call.mockResolvedValue(raw({ narrative: '正常叙事', newDate: '1931-04-08', chatter: [] }))
    expect((await runWorldSettle('1931-04-01')).aiStatus).toEqual({ status: 'ok' })
  })
  it('faction parse failure has an explicit decision status', async () => {
    mocks.invoke.mockResolvedValue({ orders: [], errors: [], parseSucceeded: false })
    expect((await decideFaction(Owner.YUN, '')).decisionStatus).toEqual({ status: 'failed', reason: 'format' })
  })
  it('valid faction empty plan is not a parse failure', async () => {
    mocks.invoke.mockResolvedValue({ orders: [], errors: [], raw: raw({ orders: [] }), parseSucceeded: true })
    expect((await decideFaction(Owner.YUN, '')).decisionStatus).toEqual({ status: 'empty' })
  })
  const battle = { id: 'b1', from: '156510100', to: '156511500', fromName: '成都', toName: '宜宾',
    attacker: Owner.SCC, defender: Owner.YUN } as BattleInfo
  const bases = new Map([['b1', { attackerLoss: 1, defenderLoss: 1 } as BaseResult]])
  it.each(['request', 'format'] as const)('reports battle flavor %s failure without throwing', async reason => {
    if (reason === 'request') mocks.call.mockRejectedValue(new Error('offline'))
    else mocks.call.mockResolvedValue(raw({ wrong: [] }))
    const report = vi.fn<(value: Pick<AiStatus, 'status' | 'reason'>) => void>()
    expect(await flavorBattles([battle], bases, report)).toEqual({})
    expect(report).toHaveBeenCalledWith({ status: 'failed', reason })
  })
  it('marks missing battle entries, but accepts valid empty events', async () => {
    const report = vi.fn<(value: Pick<AiStatus, 'status' | 'reason'>) => void>()
    mocks.call.mockResolvedValueOnce(raw({ results: [] }))
    await flavorBattles([battle], bases, report)
    expect(report).toHaveBeenLastCalledWith({ status: 'partial', reason: 'missing' })
    mocks.call.mockResolvedValueOnce(raw({ results: [{ battleId: 'b1', events: [], narrative: '静' }] }))
    expect(await flavorBattles([battle], bases, report)).toEqual({ b1: { events: [], narrative: '静' } })
    expect(report).toHaveBeenLastCalledWith({ status: 'ok' })
  })
})
