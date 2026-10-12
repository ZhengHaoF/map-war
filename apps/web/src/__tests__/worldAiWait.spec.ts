import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Owner } from '@/data/owners'
import { useGameStore, type GameEvent } from '@/stores/game'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { useSaveGame } from '@/composables/useSaveGame'
import { WORLD_AI_DEADLINE_MS } from '@/data/gameConfig'
import { AiWaitError, withAiAbort } from '@/utils/aiWait'
import { aiStatusText, type AiStatus } from '@/utils/aiStatus'
import type { GameOrder } from '@/utils/gameOrders'
import { decideFaction } from '@/utils/ai/factionAi'
import { runWorldSettle } from '@/utils/ai/worldAi'
import { flavorBattles } from '@/utils/ai/battleFlavorAi'
import type { BattleInfo } from '@/stores/game'
import type { BaseResult } from '@/utils/battleFormula'
import type { LlmControlOpts } from '@/composables/useLlmClient'

const mocks = vi.hoisted(() => ({
  faction: vi.fn<(...args: unknown[]) => Promise<object>>(),
  batch: vi.fn<(...args: unknown[]) => Promise<object>>(),
  settle: vi.fn<(...args: unknown[]) => Promise<object>>(),
  invoke: vi.fn<() => Promise<object>>(), call: vi.fn<() => Promise<unknown>>(),
  submit: vi.fn<(orders: GameOrder[], context: object) => void>(),
  advance: vi.fn<() => Promise<void>>(),
  battle: vi.fn<(control?: LlmControlOpts, report?: (outcome: Pick<AiStatus, 'status' | 'reason'>) => void, waiting?: (value: boolean) => void) => Promise<void>>(),
  toast: vi.fn<(value: unknown) => void>(),
  queued: [] as GameOrder[], submitted: [] as GameOrder[],
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
    settleActiveBattles: mocks.battle, status: ref('idle'), queue: ref([]),
    stoppedAt: ref(null), executionResults: ref([]),
    detachQueue: () => mocks.queued.splice(0).map(order => ({ order, context: {} })),
    restoreQueue: (entries: { order: GameOrder; context: object }[]) => {
      for (const e of entries) mocks.submit([e.order], e.context)
    } }) }
})
vi.mock('@/composables/useDiplomacyBus', () => ({ useDiplomacyBus: () => ({ startAiDiplomacy: vi.fn<(...args: unknown[]) => void>(),
  recoverSession: vi.fn<() => void>() }) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: mocks.toast }) }))
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
const statuses = () => useGameStore().eventLog.filter((e): e is AiStatus => e.type === 'aiStatus')
const eventsOf = (type: GameEvent['type']) => useGameStore().eventLog.filter(e => e.type === type)
const raw = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] })
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  const kernel = useAgentKernel()
  kernel.phase.value = 'idle'
  kernel.resetWaitProgress()
  mocks.queued = []; mocks.submitted = []
  mocks.faction.mockResolvedValue({ orders: [], decisionStatus: { status: 'empty' } })
  mocks.batch.mockResolvedValue({ orders: [], errors: [], parseSucceeded: true })
  mocks.settle.mockResolvedValue({ narrative: '正常叙事', newDate: '1931-04-08', chatter: [], aiStatus: { status: 'ok' } })
  mocks.battle.mockResolvedValue()
  mocks.submit.mockImplementation(orders => { mocks.queued.push(...orders); mocks.submitted.push(...orders) })
  mocks.advance.mockImplementation(async () => {
    for (const order of mocks.queued.splice(0))
      if (order.order === 'setCurrentDate') store.applyEvent({ type: 'dateAdvance', date: order.date! })
  })
})
afterEach(() => { vi.useRealTimers() })

describe('world wait lifecycle', () => {
  it('keeps a completed batch visible while a related faction waits and reports retry metadata', async () => {
    const held = deferred<object>()
    mocks.faction.mockImplementation((_f, _ctx, control) => {
      const opts = control as LlmControlOpts
      opts.onAttempt?.({ state: 'retrying', attempt: 2, maxAttempts: 3, retryDelayMs: 1000 })
      return held.promise
    })
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    expect(kernel.worldAiTasks.value.find(t => t.id === 'batch')?.state).toBe('empty')
    expect(kernel.worldAiTasks.value.find(t => t.id === `faction:${Owner.YUN}`)).toMatchObject({ state: 'retrying', attempt: 2 })
    expect(kernel.canStopAiWaiting.value).toBe(true)
    held.resolve({ orders: [] })
    await turn
    expect(kernel.loading.value).toBe(false)
    // Drain jsdom auto-save storage events (0ms, or 1ms if created within a fake-clock tick).
    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('shared cutoff releases a never-resolving faction and uses one deterministic settlement', async () => {
    mocks.faction.mockImplementation(() => new Promise(() => {}))
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    await vi.advanceTimersByTimeAsync(WORLD_AI_DEADLINE_MS)
    await turn
    expect(kernel.waitStopReason.value).toBe('timeout')
    expect(kernel.loading.value).toBe(false)
    expect(statuses()).toContainEqual(expect.objectContaining({ phase: 'faction', reason: 'timeout' }))
    expect(statuses()).toContainEqual(expect.objectContaining({ phase: 'settlement', reason: 'timeout' }))
    expect(mocks.settle).not.toHaveBeenCalled()
    expect(eventsOf('economicTick')).toHaveLength(1)
    expect(eventsOf('dateAdvance')).toHaveLength(1)
    expect(useGameStore().currentDate).toBe('1931-04-08')
    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('user stop retains ready plans, does not rollback economy, and ignores a late hostile plan', async () => {
    const held = deferred<object>()
    mocks.faction.mockImplementation(() => held.promise)
    const readyOrder = { order: 'listBattles', actor: '国民政府' } as GameOrder
    mocks.batch.mockResolvedValue({ orders: [readyOrder], errors: [[]], parseSucceeded: true })
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    expect(kernel.stopAiWaiting()).toBe(true)
    expect(kernel.stopAiWaiting()).toBe(false)
    await turn
    expect(mocks.submitted.filter(o => o.order === 'listBattles')).toEqual([readyOrder])
    expect(eventsOf('economicTick')).toHaveLength(1)
    expect(eventsOf('dateAdvance')).toHaveLength(1)
    expect(statuses().find(e => e.phase === 'batch')?.status).toBe('ok')
    expect(statuses().find(e => e.phase === 'faction')?.reason).toBe('cancelled')
    const after = JSON.stringify(useGameStore().eventLog)
    held.resolve({ orders: [{ order: 'recruit', gb: '156530600', amount: 10 }],
      telegram: 'late telegram', diplomaticProposal: { target: Owner.SCC, intent: 'war', message: 'late' } })
    await flush()
    expect(JSON.stringify(useGameStore().eventLog)).toBe(after)
    expect(mocks.submitted.some(o => o.order === 'recruit')).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('stop during settlement discards late narrative, chatter and proposed date', async () => {
    const held = deferred<object>()
    mocks.settle.mockImplementation(() => held.promise)
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    expect(kernel.worldAiTasks.value.at(-1)?.id).toBe('settlement')
    expect(kernel.stopAiWaiting()).toBe(true)
    await turn
    expect(useGameStore().currentDate).toBe('1931-04-08')
    const before = JSON.stringify(useGameStore().eventLog)
    held.resolve({ narrative: 'late narrative', newDate: '1932-01-01', chatter: [{ from: '滇系', content: 'late' }] })
    await flush()
    expect(JSON.stringify(useGameStore().eventLog)).toBe(before)
    expect(statuses().at(-1)?.reason).toBe('cancelled')
  })
  it('P3 and world narrative share the same cutoff, not a fresh deadline per stage', async () => {
    const faction = deferred<object>()
    const settle = deferred<object>()
    mocks.faction.mockImplementation(() => faction.promise)
    mocks.settle.mockImplementation(() => settle.promise)
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    await vi.advanceTimersByTimeAsync(WORLD_AI_DEADLINE_MS - 1000)
    faction.resolve({ orders: [] })
    await flush()
    expect(mocks.settle).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    await turn
    expect(statuses().at(-1)?.reason).toBe('timeout')
    expect(eventsOf('dateAdvance')).toHaveLength(1)
    expect(kernel.waitRemainingMs.value).toBe(0)
  })
  it('stop during battle-flavor wait still completes local battle settlement and skips new narrative requests', async () => {
    const held = deferred<unknown>()
    useGameStore().battles = [{ id: 'wait-front', active: true,
      attacker: Owner.SCC, defender: Owner.YUN } as BattleInfo]
    let localBattleSettled = 0
    mocks.battle.mockImplementation(async (control, report, waiting) => {
      waiting?.(true)
      await withAiAbort(() => held.promise, control?.signal).catch(() => {
        report?.({ status: 'failed', reason: 'cancelled' })
      })
      waiting?.(false)
      localBattleSettled++
    })
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn(); await flush()
    expect(kernel.worldAiTasks.value.at(-1)?.id).toBe('battleFlavor')
    expect(kernel.stopAiWaiting()).toBe(true)
    await turn
    expect(localBattleSettled).toBe(1)
    expect(kernel.worldAiTasks.value.find(t => t.id === 'battleFlavor')).toMatchObject({ state: 'failed', reason: 'cancelled' })
    expect(mocks.settle).not.toHaveBeenCalled()
    expect(eventsOf('dateAdvance')).toHaveLength(1)
    held.resolve({ late: true }); await flush()
    expect(localBattleSettled).toBe(1)
  })
  it('battle local effects after a ready flavor cannot be interrupted', async () => {
    const localEffect = deferred<void>()
    useGameStore().battles = [{ id: 'local-front', active: true,
      attacker: Owner.SCC, defender: Owner.YUN } as BattleInfo]
    mocks.battle.mockImplementation(async (_control, report, waiting) => {
      waiting?.(true)
      report?.({ status: 'ok' })
      waiting?.(false)
      await localEffect.promise
    })
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    expect(kernel.worldAiTasks.value.at(-1)?.state).toBe('ok')
    expect(kernel.loading.value).toBe(true)
    expect(kernel.stopAiWaiting()).toBe(false)
    localEffect.resolve()
    await turn
    expect(eventsOf('dateAdvance')).toHaveLength(1)
  })
  it('end-player and direct-world entry share a reentrancy lock', async () => {
    const held = deferred<object>()
    mocks.faction.mockImplementation(() => held.promise)
    const kernel = useAgentKernel()
    const turn = kernel.runWorldTurn()
    await flush()
    await kernel.endPlayerTurn()
    await kernel.runWorldTurn()
    expect(mocks.faction).toHaveBeenCalledTimes(1)
    kernel.stopAiWaiting()
    await turn
    expect(eventsOf('economicTick')).toHaveLength(1)
  })
  it('cannot interrupt accepted local execution or date effects; expiry does not duplicate them', async () => {
    const heldAdvance = deferred<void>()
    let calls = 0
    mocks.advance.mockImplementation(async () => {
      calls++
      if (calls === 2) await heldAdvance.promise
      for (const order of mocks.queued.splice(0))
        if (order.order === 'setCurrentDate') useGameStore().applyEvent({ type: 'dateAdvance', date: order.date! })
    })
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn()
    await flush()
    expect(kernel.phase.value).toBe('advancing')
    expect(kernel.canStopAiWaiting.value).toBe(false)
    expect(kernel.stopAiWaiting()).toBe(false)
    await vi.advanceTimersByTimeAsync(WORLD_AI_DEADLINE_MS)
    expect(kernel.loading.value).toBe(true)
    heldAdvance.resolve()
    await turn
    expect(eventsOf('economicTick')).toHaveLength(1)
    expect(eventsOf('dateAdvance')).toHaveLength(1)
  })
  it('can start a fresh turn after stopping; the previous result cannot enter the next ledger', async () => {
    const old = deferred<object>()
    mocks.faction.mockImplementationOnce(() => old.promise)
    const kernel = useAgentKernel()
    const first = kernel.endPlayerTurn()
    await flush(); kernel.stopAiWaiting(); await first
    mocks.settle.mockResolvedValue({ narrative: '第二轮', newDate: '1931-04-15', chatter: [] })
    await kernel.endPlayerTurn()
    expect(kernel.waitStopReason.value).toBeNull()
    expect(eventsOf('economicTick')).toHaveLength(2)
    expect(eventsOf('dateAdvance')).toHaveLength(2)
    const before = JSON.stringify(useGameStore().eventLog)
    old.resolve({ orders: [{ order: 'recruit', gb: '156530600', amount: 20 }] })
    await flush()
    expect(JSON.stringify(useGameStore().eventLog)).toBe(before)
    expect(kernel.worldAiTasks.value.find(t => t.phase === 'faction')?.state).toBe('empty')
  })
  it('blocks UI save/load during a partial world turn; normal save/load resets runtime progress', async () => {
    const store = useGameStore()
    expect(store.save('wait-baseline')).toBe(true)
    mocks.faction.mockImplementation(() => new Promise(() => {}))
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn(); await flush()
    const saves = useSaveGame()
    expect(saves.saveGame('partial')).toBe(false)
    expect(saves.loadGame('wait-baseline')).toBe(false)
    expect(store.listSaves().partial).toBeUndefined()
    kernel.stopAiWaiting(); await turn
    expect(saves.saveGame('complete')).toBe(true)
    expect(saves.loadGame('complete')).toBe(true)
    expect(kernel.worldAiTasks.value).toEqual([])
    expect(kernel.waitDeadlineAt.value).toBeNull()
    expect(kernel.waitStopReason.value).toBeNull()
  })
  it('forced world replacement invalidates all waiting work without settling the replacement', async () => {
    const held = deferred<object>()
    mocks.faction.mockImplementation(() => held.promise)
    const kernel = useAgentKernel()
    const turn = kernel.endPlayerTurn(); await flush()
    const store = useGameStore()
    store.initWorld()
    store.selectFaction(Owner.SCC)
    const replacement = JSON.stringify(store.eventLog)
    await turn
    held.resolve({ orders: [{ order: 'recruit', gb: '156530600', amount: 5 }] })
    await flush()
    expect(JSON.stringify(store.eventLog)).toBe(replacement)
    expect(kernel.loading.value).toBe(false)
    expect(kernel.phase.value).toBe('idle')
    expect(kernel.worldAiTasks.value).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AI module late-effect isolation', () => {
  it('a cancelled real faction parser cannot append late refusal receipts', async () => {
    const held = deferred<object>()
    mocks.invoke.mockImplementation(() => held.promise)
    const c = new AbortController()
    const result = decideFaction(Owner.YUN, '', { signal: c.signal }).catch(e => e)
    await flush()
    c.abort(new AiWaitError('cancelled'))
    expect(await result).toMatchObject({ reason: 'cancelled' })
    const before = JSON.stringify(useGameStore().eventLog)
    held.resolve({ orders: [{ order: 'capture', gb: '156510100' }], errors: [['forbidden']],
      parseSucceeded: true, raw: raw({ orders: [] }) })
    await flush()
    expect(JSON.stringify(useGameStore().eventLog)).toBe(before)
  })
  it.each(['cancelled', 'timeout'] as const)('world narrative %s remains a marked deterministic fallback', async reason => {
    const held = deferred<unknown>()
    mocks.call.mockImplementation(() => held.promise)
    const c = new AbortController()
    const result = runWorldSettle('1931-04-01', { signal: c.signal })
    await flush(); c.abort(new AiWaitError(reason))
    const fallback = await result
    expect(fallback.aiStatus).toEqual({ status: 'failed', reason })
    expect(fallback.newDate).toBe('1931-04-08')
    expect(fallback.chatter).toEqual([])
    held.resolve(raw({ narrative: 'late', newDate: '1932-01-01', chatter: [{ from: 'x', content: 'late' }] }))
    await flush()
    expect(fallback.newDate).toBe('1931-04-08')
  })
  it('cancelled battle flavor returns zero adjustment and reports exactly once despite late shock', async () => {
    const held = deferred<unknown>()
    mocks.call.mockImplementation(() => held.promise)
    const c = new AbortController()
    const report = vi.fn<(outcome: Pick<AiStatus, 'status' | 'reason'>) => void>()
    const battle = { id: 'b1', from: '156510100', to: '156530600', fromName: '成都', toName: '昭通',
      attacker: Owner.SCC, defender: Owner.YUN } as BattleInfo
    const result = flavorBattles([battle], new Map([['b1', { attackerLoss: 1, defenderLoss: 1 } as BaseResult]]), report, { signal: c.signal })
    await flush(); c.abort(new AiWaitError('cancelled'))
    expect(await result).toEqual({})
    expect(report).toHaveBeenCalledExactlyOnceWith({ status: 'failed', reason: 'cancelled' })
    held.resolve(raw({ results: [{ battleId: 'b1', events: [{ type: 'shock', side: 'attacker', magnitude: 9 }] }] }))
    await flush()
    expect(report).toHaveBeenCalledTimes(1)
  })
  it('timeout and cancellation are never described as voluntary empty plans', () => {
    for (const reason of ['timeout', 'cancelled'] as const) {
      const text = aiStatusText({ type: 'aiStatus', phase: 'faction', factions: [Owner.YUN], status: 'failed', reason })
      expect(text).toContain('决策缺失')
      expect(text).toContain('不代表主动按兵不动')
      expect(text).not.toContain('有效回复，无行动计划')
    }
  })
})
