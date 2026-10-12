/**
 * 回合运行时（awaiting-player 暂停 / 恢复 / 故障断点）回归测试。
 * 真实 store + 真实调度器 + 真实编排器；模型与动画均为可控桩，不调用任何真实模型或 API。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { useAgentKernel, type PendingTurnSnapshot } from '@/composables/useAgentKernel'
import { useSaveGame } from '@/composables/useSaveGame'
import { registerLocations } from '@/utils/locationResolver'
import seedCities from '@/data/chinaCities.seed.json'
import type { GameOrder } from '@/utils/gameOrders'

const mocks = vi.hoisted(() => ({
  faction: vi.fn<(...args: unknown[]) => Promise<object>>(),
  batch: vi.fn<(...args: unknown[]) => Promise<object>>(),
  settle: vi.fn<(...args: unknown[]) => Promise<object>>(),
  flavor: vi.fn<(...args: unknown[]) => Promise<object>>(),
  jump: null as null | ((date: string) => Promise<unknown>),
}))
vi.mock('@/utils/aiClassify', () => ({ classifyFactions: () => ({ related: ['YUN'], unrelated: [] }) }))
vi.mock('@/utils/ai', async () => ({
  ...await vi.importActual('@/utils/aiOrderContract'),
  buildFactionContext: () => '', buildMinorContext: () => '',
  decideFaction: mocks.faction, runWorldBatch: mocks.batch, runWorldSettle: mocks.settle,
  flavorBattles: mocks.flavor,
}))
vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => void>(), playScoutAnimation: vi.fn<() => void>(),
  startBattleAnimation: vi.fn<() => void>(), playCaptureAnimation: vi.fn<() => void>(),
  playDevelopAnimation: vi.fn<() => Promise<void>>(async () => {}),
}))
vi.mock('@/utils/gameOrders', async () => {
  const actual = await vi.importActual<typeof import('@/utils/gameOrders')>('@/utils/gameOrders')
  return { ...actual, playTimeJump: (date: string) => (mocks.jump ?? actual.playTimeJump)(date) }
})
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<(value: unknown) => void>() }) }))

const count = (type: GameEvent['type']) => useGameStore().eventLog.filter(e => e.type === type).length
const yunCity = () => Object.values(useGameStore().cities).find(c => c.owner === Owner.YUN)!
const sccCity = () => Object.values(useGameStore().cities).find(c => c.owner === Owner.SCC)!
const pauseThenRecruit = (gb: string): GameOrder[] => [
  { order: 'recruit', gb, amount: 1, needsPlayerDecision: true },
  { order: 'recruit', gb, amount: 1 },
]

beforeEach(() => {
  localStorage.clear()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  registerLocations(seedCities.map(c => ({
    type: 'Feature', properties: { gb: c.gb, name: c.name },
    geometry: { type: 'Point', coordinates: [104, 28] },
  })) as GeoJSON.Feature[], 'gb')
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
  scheduler.stoppedAt.value = null
  const kernel = useAgentKernel()
  kernel.discardPendingTurn()
  kernel.phase.value = 'idle'
  mocks.jump = null
  mocks.faction.mockReset().mockResolvedValue({ orders: [] })
  mocks.batch.mockReset().mockResolvedValue({ orders: [], errors: [], parseSucceeded: true })
  mocks.settle.mockReset().mockResolvedValue({ narrative: '叙事', newDate: '1931-04-08', chatter: [] })
  mocks.flavor.mockReset().mockResolvedValue({})
})

describe('scheduler queue invariants', () => {
  it('keeps the date order queued across a player-decision stop and commits it once on resume', async () => {
    const store = useGameStore()
    const scheduler = useGameScheduler()
    const date = store.currentDate
    scheduler.submit([{ order: 'recruit', gb: sccCity().gb, amount: 1, needsPlayerDecision: true },
      { order: 'setCurrentDate', date: '1931-04-08' }], { authority: 'system' })
    expect(await scheduler.advance()).toBe('stopped')
    expect(store.currentDate).toBe(date)
    expect(scheduler.queue.value.map(o => o.order)).toEqual(['setCurrentDate'])
    expect(await scheduler.advance()).toBe('done')
    expect(store.currentDate).toBe('1931-04-08')
    expect(count('dateAdvance')).toBe(1)
  })
  it('a failing guard leaves unexecuted orders and dates queued, status idle, and rethrows', async () => {
    const scheduler = useGameScheduler()
    const gb = sccCity().gb
    scheduler.submit([{ order: 'recruit', gb, amount: 1 }, { order: 'setCurrentDate', date: '1931-04-08' }],
      { authority: 'system' })
    await expect(scheduler.advance({ guard: () => { throw new Error('stale') } })).rejects.toThrow('stale')
    expect(scheduler.status.value).toBe('idle')
    expect(scheduler.queue.value.map(o => o.order)).toEqual(['recruit', 'setCurrentDate'])
  })
  it('a world replaced during an order await writes no receipt/pause into the new world', async () => {
    const store = useGameStore()
    const scheduler = useGameScheduler()
    let stale = false
    scheduler.submit([{ order: 'recruit', gb: sccCity().gb, amount: 1, needsPlayerDecision: true },
      { order: 'setCurrentDate', date: '1931-04-08' }])
    const pending = scheduler.advance({ guard: () => { if (stale) throw new Error('stale') } })
    stale = true
    await expect(pending).rejects.toThrow('stale')
    expect(store.eventLog.some(e => e.type === 'commandReceipt' || e.type === 'pauseForPlayer')).toBe(false)
    expect(count('dateAdvance')).toBe(0)
  })
  it('a failed time-jump presentation still commits the date exactly once', async () => {
    const store = useGameStore()
    mocks.jump = async () => { throw new Error('renderer failed') }
    useGameScheduler().submit([{ order: 'setCurrentDate', date: '1931-04-08' }], { authority: 'system' })
    expect(await useGameScheduler().advance()).toBe('done')
    expect(store.currentDate).toBe('1931-04-08')
    expect(count('dateAdvance')).toBe(1)
    // 演出在中点已提交后再抛错：不重复提交
    mocks.jump = async (date) => { store.applyEvent({ type: 'dateAdvance', date }); throw new Error('late') }
    useGameScheduler().submit([{ order: 'setCurrentDate', date: '1931-04-15' }], { authority: 'system' })
    await useGameScheduler().advance()
    expect(count('dateAdvance')).toBe(2)
  })
  it('detach/restore preserves execution context', async () => {
    const scheduler = useGameScheduler()
    const order = { order: 'recruit', gb: yunCity().gb, amount: 1 } as GameOrder
    scheduler.submit([order], { authority: 'faction', actor: Owner.YUN })
    const entries = scheduler.detachQueue()
    expect(scheduler.queue.value).toEqual([])
    expect(entries).toEqual([{ order, context: { authority: 'faction', actor: Owner.YUN } }])
    scheduler.restoreQueue(entries)
    const troops = yunCity().troops
    await scheduler.advance()
    expect(yunCity().troops).toBe(troops + 1)
  })
})

describe('world turn awaiting-player session', () => {
  it('pauses without battle/narrative/date, then resumes once without re-taxing or re-asking models', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    const city = yunCity()
    const troops = city.troops
    const date = store.currentDate
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(city.gb) })
    expect(await kernel.endPlayerTurn()).toBe('awaiting-player')
    expect(kernel.awaitingPlayer.value).toBe(true)
    expect(kernel.loading.value).toBe(false)
    expect(store.cities[city.gb]!.troops).toBe(troops + 1)
    expect(store.currentDate).toBe(date)
    expect(store.pausedForPlayer).toBe(true)
    expect(count('economicTick')).toBe(1)
    expect(count('narrative')).toBe(0)
    expect(mocks.settle).not.toHaveBeenCalled()
    // 剩余世界指令不留在公共队列里（不阻塞玩家 UI，也不会被玩家指令捎带执行）
    expect(useGameScheduler().queue.value).toEqual([])

    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(store.cities[city.gb]!.troops).toBe(troops + 2)
    expect(store.currentDate).toBe('1931-04-08')
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
    expect(mocks.settle).toHaveBeenCalledTimes(1)
    expect(kernel.awaitingPlayer.value).toBe(false)
  })
  it('player commands during the pause run independently; world leftovers stay with the session', async () => {
    const kernel = useAgentKernel()
    const scheduler = useGameScheduler()
    const yun = yunCity(), scc = sccCity()
    const yunTroops = yun.troops, sccTroops = scc.troops
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(yun.gb) })
    await kernel.endPlayerTurn()
    scheduler.submit([{ order: 'recruit', gb: scc.gb, amount: 1 }])
    expect(await scheduler.advance()).toBe('done')
    expect(useGameStore().cities[scc.gb]!.troops).toBe(sccTroops + 1)
    expect(useGameStore().cities[yun.gb]!.troops).toBe(yunTroops + 1)
    await kernel.endPlayerTurn()
    expect(useGameStore().cities[yun.gb]!.troops).toBe(yunTroops + 2)
  })
  it('a replaced world invalidates the paused session; old leftovers never run', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(yunCity().gb) })
    await kernel.endPlayerTurn()
    store.initWorld()
    store.selectFaction(Owner.SCC)
    const fresh = yunCity()
    const troops = fresh.troops
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(store.cities[fresh.gb]!.troops).toBe(troops)
    expect(count('economicTick')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(2)
  })
  it('save while paused + load restores the session through export/import', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    const saves = useSaveGame()
    const city = yunCity()
    const troops = city.troops
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(city.gb) })
    await kernel.endPlayerTurn()
    expect(saves.saveGame('paused')).toBe(true)
    // 读档前先把世界弄乱，确认恢复来自存档
    store.initWorld(); store.selectFaction(Owner.SCC)
    expect(saves.loadGame('paused')).toBe(true)
    expect(kernel.awaitingPlayer.value).toBe(true)
    expect(store.cities[city.gb]!.troops).toBe(troops + 1)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(store.cities[city.gb]!.troops).toBe(troops + 2)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
  })
  it('a player-residual pause (drain stage) survives save/load and resumes before taxing', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    const scheduler = useGameScheduler()
    const city = sccCity()
    const troops = city.troops
    scheduler.submit([{ order: 'recruit', gb: city.gb, amount: 1, needsPlayerDecision: true },
      { order: 'recruit', gb: city.gb, amount: 1 }])
    expect(await kernel.endPlayerTurn()).toBe('awaiting-player')
    expect(count('economicTick')).toBe(0)
    const snap = kernel.exportPendingTurn()!
    expect(snap.stage).toBe('drain')
    expect(snap.remaining[0]!.context).toEqual({ authority: 'player', actor: Owner.SCC })
    expect(useSaveGame().saveGame('drain-paused')).toBe(true)
    expect(useSaveGame().loadGame('drain-paused')).toBe(true)
    expect(kernel.awaitingPlayer.value).toBe(true)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(store.cities[city.gb]!.troops).toBe(troops + 2)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
  })
  it('a paused save without runtime snapshot resumes in settle-only recovery (no second tax/decision)', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(yunCity().gb) })
    await kernel.endPlayerTurn()
    expect(store.save('raw-paused', { pendingTurn: null })).toBe(true)
    expect(useSaveGame().loadGame('raw-paused')).toBe(true)
    expect(kernel.awaitingPlayer.value).toBe(false)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
  })
  it('direct auto/diplomacy saves include the injected paused checkpoint', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    const city = yunCity(), troops = city.troops
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(city.gb) })
    expect(await kernel.endPlayerTurn()).toBe('awaiting-player')
    expect(store.save('auto', { label: '外交收口' })).toBe(true)
    expect(JSON.parse(localStorage.getItem('mapwar_save_auto')!).pendingTurn.stage).toBe('execute')
    store.initWorld(); store.selectFaction(Owner.SCC)
    expect(useSaveGame().loadGame('auto')).toBe(true)
    expect(kernel.awaitingPlayer.value).toBe(true)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(store.cities[city.gb]!.troops).toBe(troops + 2)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
  })
  it('import rejects tampered snapshots (system authority, impossible stage, wrong anchor)', async () => {
    const kernel = useAgentKernel()
    mocks.faction.mockResolvedValueOnce({ orders: pauseThenRecruit(yunCity().gb) })
    await kernel.endPlayerTurn()
    const good = kernel.exportPendingTurn()!
    expect(good.stage).toBe('execute')
    const variants: PendingTurnSnapshot[] = [
      { ...good, remaining: [{ order: { order: 'capture', gb: sccCity().gb } as GameOrder,
        context: { authority: 'system' } }] },
      { ...good, remaining: [{ order: { order: 'setCurrentDate', date: '1932-01-01' } as GameOrder,
        context: { authority: 'faction', actor: Owner.YUN } }] },
      { ...good, stage: 'ai' },
      { ...good, stage: 'bogus' as never },
      { ...good, anchorIndex: good.anchorIndex - 1 },
      { ...good, baseDate: '1932-01-01' },
      { ...good, remaining: 'x' as never },
    ]
    for (const v of variants) expect(kernel.importPendingTurn(v)).toBe(false)
    expect(kernel.importPendingTurn(good)).toBe(true)
  })
})

describe('settle-only recovery markers', () => {
  it('a diplomacy settlement narrative is not mistaken for the world-turn summary', async () => {
    const store = useGameStore()
    store.applyEvent({ type: 'economicTick', entries: [] })
    store.applyEvent({ type: 'narrative', playerInput: '', aiMessage: '外交收口', kind: 'settlement' })
    expect(await useAgentKernel().endPlayerTurn()).toBe('committed')
    expect(mocks.settle).toHaveBeenCalledTimes(1)
    expect(mocks.faction).not.toHaveBeenCalled()
    expect(count('economicTick')).toBe(1)
    expect(store.eventLog.filter(e => e.type === 'narrative' && e.scope === 'world-turn')).toHaveLength(1)
  })
})

describe('battle settlement boundaries', () => {
  const startFront = () => {
    const store = useGameStore()
    const from = sccCity(), to = yunCity()
    store.cities[from.gb] = { ...store.cities[from.gb]!, troops: 30, fieldForce: 20 }
    store.applyEvent({ type: 'battleStart', battleId: 'rt-front', fromGb: from.gb, targetGb: to.gb,
      fromName: from.name, toName: to.name, attacker: Owner.SCC, defender: Owner.YUN })
    return { from: from.gb, to: to.gb }
  }
  it('a target that changed owner during the flavor await is not settled on stale premises', async () => {
    const store = useGameStore()
    const { to } = startFront()
    mocks.flavor.mockImplementationOnce(async () => {
      store.cities[to] = { ...store.cities[to]!, owner: Owner.KMT }
      return {}
    })
    await useGameScheduler().settleActiveBattles()
    expect(count('attack')).toBe(0)
    expect(store.battles.some(b => b.id === 'rt-front' && b.active)).toBe(false)
  })
  it('a stale guard after the flavor await drops all battle effects', async () => {
    const store = useGameStore()
    startFront()
    let stale = false
    mocks.flavor.mockImplementationOnce(async () => { stale = true; return {} })
    await expect(useGameScheduler().settleActiveBattles(undefined, undefined, undefined,
      () => { if (stale) throw new Error('stale') })).rejects.toThrow('stale')
    expect(count('attack')).toBe(0)
    expect(store.battles.some(b => b.id === 'rt-front' && b.active)).toBe(true)
  })
  it('a flavor-stage failure keeps a breakpoint; retry plays exactly one battle round without re-taxing', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    startFront()
    mocks.flavor.mockRejectedValueOnce(new Error('flavor crashed'))
    expect(await kernel.endPlayerTurn()).toBe('failed')
    expect(kernel.phase.value).toBe('error')
    expect(store.currentDate).not.toBe('1931-04-08')
    expect(count('attack')).toBe(0)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(mocks.flavor).toHaveBeenCalledTimes(2)
    expect(count('attack')).toBe(1)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
  })
})
