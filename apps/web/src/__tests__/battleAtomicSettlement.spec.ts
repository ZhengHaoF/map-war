/**
 * 战斗整轮原子提交回归测试。
 * 真实 store + 真实调度器 + 真实编排器；模型、动画与 toast 均为可控桩，不调用任何真实模型或 API。
 * 失败注入通过 vi.spyOn(store.transact) 包裹事务落地器实现，不依赖生产代码中的测试钩子。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { registerLocations } from '@/utils/locationResolver'
import seedCities from '@/data/chinaCities.seed.json'

const mocks = vi.hoisted(() => ({
  faction: vi.fn<(...args: unknown[]) => Promise<object>>(),
  batch: vi.fn<(...args: unknown[]) => Promise<object>>(),
  settle: vi.fn<(...args: unknown[]) => Promise<object>>(),
  flavor: vi.fn<(...args: unknown[]) => Promise<object>>(),
  toast: vi.fn<(value: unknown) => void>(),
  stopVisual: vi.fn<(id: string) => void>(),
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
  return { ...actual, playTimeJump: async () => {}, stopBattleVisual: (id: string) => mocks.stopVisual(id) }
})
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: mocks.toast }) }))

type Store = ReturnType<typeof useGameStore>
type Emit = (e: GameEvent) => void

const count = (type: GameEvent['type']) => useGameStore().eventLog.filter(e => e.type === type).length
const owned = (o: Owner) => Object.values(useGameStore().cities).filter(c => c.owner === o)
const worldState = (store: Store) => JSON.parse(JSON.stringify({
  snapshot: store.getSnapshot(), log: store.eventLog, battles: store.battles,
  gameOver: store.gameOver, captures: store.playerCaptures, milestones: store.milestonesUnlocked,
}))

/** 两条战线：SCC→YUN（守军非空，走公式）与 SCC→GUI（守军为 0，前置检查直接占领）。 */
function twoFronts() {
  const store = useGameStore()
  const [a1, a2] = owned(Owner.SCC)
  const d1 = owned(Owner.YUN)[0]!
  const d2 = owned(Owner.GUI)[0]!
  store.cities = {
    ...store.cities,
    [a1!.gb]: { ...a1!, troops: 30, fieldForce: 20 },
    [a2!.gb]: { ...a2!, troops: 30, fieldForce: 15 },
    [d2.gb]: { ...d2, troops: 0 },
  }
  store.applyEvent({ type: 'battleStart', battleId: 'f-yun', fromGb: a1!.gb, targetGb: d1.gb,
    fromName: a1!.name, toName: d1.name, attacker: Owner.SCC, defender: Owner.YUN })
  store.applyEvent({ type: 'battleStart', battleId: 'f-gui', fromGb: a2!.gb, targetGb: d2.gb,
    fromName: a2!.name, toName: d2.name, attacker: Owner.SCC, defender: Owner.GUI })
  return { a1: a1!.gb, a2: a2!.gb, d1: d1.gb, d2: d2.gb }
}

/** 把下一次（或第 nth 次）store.transact 的落地器包一层，用于注入失败。 */
function wrapNextTransact(store: Store, wrap: (emit: Emit, calls: { n: number }) => Emit) {
  const original = store.transact
  return vi.spyOn(store, 'transact').mockImplementationOnce(((fn: (apply: Emit) => unknown, opts?: object) =>
    original((emit: Emit) => fn(wrap(emit, { n: 0 })), opts)) as typeof store.transact)
}

beforeEach(() => {
  mocks.toast.mockReset()
  mocks.stopVisual.mockReset()
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
  mocks.faction.mockReset().mockResolvedValue({ orders: [] })
  mocks.batch.mockReset().mockResolvedValue({ orders: [], errors: [], parseSucceeded: true })
  mocks.settle.mockReset().mockResolvedValue({ narrative: '叙事', newDate: '1931-04-08', chatter: [] })
  mocks.flavor.mockReset().mockResolvedValue({})
  mocks.toast.mockClear() // 择势提示等开局提示不计入
})
afterEach(() => { vi.restoreAllMocks() })

describe('store 同步事务', () => {
  it('提交成功：本批事件一次性追加，延后提示随结果返回', () => {
    const store = useGameStore()
    const gb = owned(Owner.SCC)[0]!.gb
    const before = store.eventLog.length
    const r = store.transact(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -3 })
      apply({ type: 'moraleChange', targetGb: gb, delta: -2 })
      // 事务内读到最新态
      return store.cities[gb]!.morale
    })
    expect(r.ok).toBe(true)
    expect(store.eventLog.length).toBe(before + 2)
    expect(r.ok ? r.value : null).toBe(store.cities[gb]!.morale)
  })

  it('被拒事件即使调用方忽略返回值（直接 store.applyEvent）也使整批回滚', () => {
    const store = useGameStore()
    const gb = owned(Owner.SCC)[0]!.gb
    const before = worldState(store)
    const r = store.transact(() => {
      store.applyEvent({ type: 'moraleChange', targetGb: gb, delta: -5 })
      store.applyEvent({ type: 'moraleChange', targetGb: 'no-such-city', delta: -5 })
    })
    expect(r.ok).toBe(false)
    expect(worldState(store)).toEqual(before)
  })

  it('混入 dateAdvance、返回 thenable 或抛错都整批回滚', () => {
    const store = useGameStore()
    const gb = owned(Owner.SCC)[0]!.gb
    const before = worldState(store)
    expect(store.transact(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -5 })
      apply({ type: 'dateAdvance', date: '1931-04-08' })
    }).ok).toBe(false)
    expect(store.transact(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -5 })
      return Promise.resolve()
    }).ok).toBe(false)
    expect(store.transact(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -5 })
      throw new Error('boom')
    }).ok).toBe(false)
    expect(worldState(store)).toEqual(before)
  })

  it('旧事务的落地器在事务结束后、乃至新事务打开时调用都会被拒', () => {
    const store = useGameStore()
    const gb = owned(Owner.SCC)[0]!.gb
    let stale: Emit | null = null
    expect(store.transact(apply => { stale = apply }).ok).toBe(true)
    const len = store.eventLog.length
    expect(() => stale!({ type: 'moraleChange', targetGb: gb, delta: -5 })).toThrow('晚到')
    const before = store.cities[gb]!.morale
    const r = store.transact(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -1 })
      stale!({ type: 'moraleChange', targetGb: gb, delta: -50 })
    })
    expect(r.ok).toBe(false)
    expect(store.cities[gb]!.morale).toBe(before)
    expect(store.eventLog.length).toBe(len)
    // 预演发放的落地器同样不能在之后的提交事务里使用
    let dryEmit: Emit | null = null
    store.simulate(apply => { dryEmit = apply })
    expect(store.transact(() => { dryEmit!({ type: 'moraleChange', targetGb: gb, delta: -1 }) }).ok).toBe(false)
    expect(store.eventLog.length).toBe(len)
  })

  it('嵌套势力存亡审计纳入同批；覆灭提示延后返回，提交前不弹', () => {
    const store = useGameStore()
    const victims = owned(Owner.TIB)
    expect(victims.length).toBeGreaterThan(0)
    const r = store.transact(apply => {
      for (const c of victims) apply({ type: 'capture', targetGb: c.gb, actor: Owner.SCC })
    })
    expect(r.ok).toBe(true)
    expect(mocks.toast).not.toHaveBeenCalled()
    const events = r.ok ? r.events : []
    const notices = r.ok ? r.notices : []
    expect(events.some(e => e.type === 'setFactionAlive' && e.faction === Owner.TIB && !e.alive)).toBe(true)
    expect(notices.some(n => n.title === '势力覆灭')).toBe(true)
    expect(store.activeFactions).not.toContain(Owner.TIB)
  })

  it('嵌套审计事件在整批失败时一并回滚', () => {
    const store = useGameStore()
    const victims = owned(Owner.TIB)
    const before = worldState(store)
    const r = store.transact(apply => {
      for (const c of victims) apply({ type: 'capture', targetGb: c.gb, actor: Owner.SCC })
      apply({ type: 'moraleChange', targetGb: 'no-such-city', delta: 1 })
    })
    expect(r.ok).toBe(false)
    expect(worldState(store)).toEqual(before)
    expect(store.activeFactions).toContain(Owner.TIB)
  })

  it('预演只返回计算结果；回滚后默认 flush 的 watcher 只看到与之前相等的值', async () => {
    const store = useGameStore()
    const gb = owned(Owner.SCC)[0]!.gb
    const before = worldState(store)
    const seen: number[] = []
    const stop = watch(() => store.cities[gb]!.morale, v => { seen.push(v) })
    const r = store.simulate(apply => {
      apply({ type: 'moraleChange', targetGb: gb, delta: -20 })
      return store.cities[gb]!.morale
    })
    await nextTick()
    stop()
    expect(r.ok && r.value).toBe(before.snapshot.cities[gb].morale - 20)
    expect(seen).toEqual([])
    expect(worldState(store)).toEqual(before)
    expect(store.isReplaying).toBe(false)
  })
})

describe('整轮战斗原子提交（调度器）', () => {
  it('成功：两条战线一次事务提交，每线恰好一轮；演出在提交后发生', async () => {
    const store = useGameStore()
    const { d2 } = twoFronts()
    const spy = vi.spyOn(store, 'transact')
    const onCommit = vi.fn<() => void>()
    await useGameScheduler().settleActiveBattles(undefined, undefined, undefined, undefined, onCommit)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(count('attack')).toBe(1) // f-yun 走公式
    expect(store.cities[d2]!.owner).toBe(Owner.SCC) // f-gui 空城占领
    expect(store.battles.some(b => b.id === 'f-gui')).toBe(false)
    expect(mocks.stopVisual).toHaveBeenCalledWith('f-gui')
    expect(mocks.toast.mock.calls.some(([t]) => (t as { title: string }).title === '城池陷落')).toBe(true)
    expect(onCommit.mock.invocationCallOrder[0]!).toBeLessThan(mocks.stopVisual.mock.invocationCallOrder[0]!)
  })

  it('模型 await 期间 live 世界不含任何本轮战果（含前置检查的占领与奖惩）', async () => {
    const store = useGameStore()
    twoFronts()
    const before = worldState(store)
    let during: unknown = null
    mocks.flavor.mockImplementationOnce(async () => { during = worldState(store); return {} })
    await useGameScheduler().settleActiveBattles()
    expect(during).toEqual(before)
    expect(mocks.flavor.mock.calls[0]![0]).toHaveLength(1) // 只有公式战线送调味
  })

  it('提交末尾注入失败：多战线全部回滚，无 toast/动画/onCommit/aiStatus，可再结算恰好一次', async () => {
    const store = useGameStore()
    twoFronts()
    const before = worldState(store)
    mocks.flavor.mockImplementationOnce(async (_b, _r, onStatus) => {
      (onStatus as (o: object) => void)({ status: 'ok' })
      return {}
    })
    const original = store.transact
    vi.spyOn(store, 'transact').mockImplementationOnce(((fn: (apply: Emit) => unknown, opts?: object) =>
      original((emit: Emit) => { fn(emit); throw new Error('injected commit fault') }, opts)) as typeof store.transact)
    const onCommit = vi.fn<() => void>()
    await expect(useGameScheduler().settleActiveBattles(undefined, undefined, undefined, undefined, onCommit))
      .rejects.toThrow('战斗结算未提交')
    expect(worldState(store)).toEqual(before)
    expect(count('aiStatus')).toBe(0)
    expect(onCommit).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.stopVisual).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    await useGameScheduler().settleActiveBattles()
    expect(count('attack')).toBe(1)
    expect(count('battleEnd')).toBe(1)
  })

  it('中途非法事件（第二条战线落地时被拒）：第一条战线已落地部分一并回滚', async () => {
    const store = useGameStore()
    twoFronts()
    const before = worldState(store)
    wrapNextTransact(store, emit => e => {
      // 前置检查的空城占领先落地，随后 f-yun 的 attack 被替换为非法事件
      if (e.type === 'attack') emit({ ...e, targetGb: 'no-such-city' })
      else emit(e)
    })
    await expect(useGameScheduler().settleActiveBattles()).rejects.toThrow('战斗结算未提交')
    expect(worldState(store)).toEqual(before)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('调味返回后会话失效（晚到结果）：不提交任何战果', async () => {
    const store = useGameStore()
    twoFronts()
    const before = worldState(store)
    let stale = false
    mocks.flavor.mockImplementationOnce(async () => { stale = true; return {} })
    const spy = vi.spyOn(store, 'transact')
    await expect(useGameScheduler().settleActiveBattles(undefined, undefined, undefined,
      () => { if (stale) throw new Error('stale') })).rejects.toThrow('stale')
    expect(spy).not.toHaveBeenCalled()
    expect(worldState(store)).toEqual(before)
  })

  it('空城目标在调味等待期间被第三方接管：撤销战线，不按旧战线占领第三方', async () => {
    const store = useGameStore()
    const { d1, d2, a2 } = twoFronts()
    mocks.flavor.mockImplementationOnce(async () => {
      // 公式战线 f-yun 的目标被 KMT 接管且守军归零；f-gui 空城也被 KMT 接管
      store.cities = { ...store.cities, [d1]: { ...store.cities[d1]!, owner: Owner.KMT, troops: 0 },
        [d2]: { ...store.cities[d2]!, owner: Owner.KMT, troops: 0 } }
      return {}
    })
    const field = store.cities[a2]!.fieldForce
    const troops = store.cities[a2]!.troops
    await useGameScheduler().settleActiveBattles()
    expect(store.cities[d1]!.owner).toBe(Owner.KMT)
    expect(store.cities[d2]!.owner).toBe(Owner.KMT)
    expect(count('capture')).toBe(0)
    expect(count('attack')).toBe(0)
    expect(store.battles.filter(b => b.active)).toHaveLength(0)
    expect(store.cities[a2]!).toMatchObject({ fieldForce: 0, troops: troops + field })
  })

  it('推演阶段同样不截获已易主的空城', async () => {
    const store = useGameStore()
    const { d2 } = twoFronts()
    store.cities = { ...store.cities, [d2]: { ...store.cities[d2]!, owner: Owner.KMT } }
    await useGameScheduler().settleActiveBattles()
    expect(store.cities[d2]!.owner).toBe(Owner.KMT)
    expect(store.eventLog.some(e => e.type === 'capture')).toBe(false)
  })

  it('视觉/提示失败不回滚已提交战果', async () => {
    const store = useGameStore()
    const { d2 } = twoFronts()
    mocks.stopVisual.mockImplementation(() => { throw new Error('pixi gone') })
    mocks.toast.mockImplementation(() => { throw new Error('toast gone') })
    const onCommit = vi.fn<() => void>()
    await useGameScheduler().settleActiveBattles(undefined, undefined, undefined, undefined, onCommit)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(store.cities[d2]!.owner).toBe(Owner.SCC)
    expect(count('attack')).toBe(1)
  })

  it('同一时间只允许一轮结算', async () => {
    twoFronts()
    let release!: () => void
    mocks.flavor.mockImplementationOnce(() => new Promise(r => { release = () => r({}) }))
    const first = useGameScheduler().settleActiveBattles()
    await expect(useGameScheduler().settleActiveBattles()).rejects.toThrow('正在进行')
    release()
    await first
    expect(count('attack')).toBe(1)
  })
})

describe('整轮战斗原子提交（编排器正常入口：每日期恰好一次）', () => {
  it('提交失败 → failed；重试 → 每线一轮、只收税一次、只推进一次日期', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    const { d2 } = twoFronts()
    const original = store.transact
    vi.spyOn(store, 'transact').mockImplementationOnce(((fn: (apply: Emit) => unknown, opts?: object) =>
      original((emit: Emit) => { fn(emit); throw new Error('injected') }, opts)) as typeof store.transact)
    expect(await kernel.endPlayerTurn()).toBe('failed')
    expect(count('attack')).toBe(0)
    expect(store.cities[d2]!.owner).toBe(Owner.GUI)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(count('attack')).toBe(1)
    expect(count('capture')).toBe(1)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
    expect(mocks.faction).toHaveBeenCalledTimes(1)
  })

  it('战果已提交后叙事阶段失败：重试不重打战斗', async () => {
    const kernel = useAgentKernel()
    twoFronts()
    // 叙事模型失败会降级为默认叙事，不进入 failed；改为让叙事落地后的电报写入抛错，模拟战后失败
    const store = useGameStore()
    mocks.settle.mockReset().mockResolvedValue({ narrative: '叙事', newDate: '1931-04-08',
      chatter: [{ from: '川军', content: 'x', name: 'n' }] })
    vi.spyOn(store, 'pushTelegram').mockImplementationOnce(() => { throw new Error('telegram crashed') })
    expect(await kernel.endPlayerTurn()).toBe('failed')
    expect(count('attack')).toBe(1)
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(count('attack')).toBe(1)
    expect(mocks.flavor).toHaveBeenCalledTimes(1)
    expect(count('dateAdvance')).toBe(1)
  })

  it('演出失败：回合照常提交，战斗不重打', async () => {
    const kernel = useAgentKernel()
    twoFronts()
    mocks.stopVisual.mockImplementation(() => { throw new Error('pixi gone') })
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(count('attack')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
  })

  it('无运行时断点时以日志兜底：本回合已有战斗回合则不重打', async () => {
    const store = useGameStore()
    const kernel = useAgentKernel()
    twoFronts()
    // 先收税并完成本日期战斗（模拟断点丢失），再走日志恢复
    mocks.settle.mockReset().mockResolvedValue({ narrative: '叙事', newDate: '1931-04-08',
      chatter: [{ from: '川军', content: 'x', name: 'n' }] })
    vi.spyOn(store, 'pushTelegram').mockImplementationOnce(() => { throw new Error('telegram crashed') })
    expect(await kernel.endPlayerTurn()).toBe('failed')
    kernel.discardPendingTurn()
    expect(await kernel.endPlayerTurn()).toBe('committed')
    expect(count('attack')).toBe(1)
    expect(count('economicTick')).toBe(1)
    expect(count('dateAdvance')).toBe(1)
  })
})
