/**
 * gameStore.applyEvent 签名改造单测
 * #1 改动：
 * - 签名从 void 改为 { ok, reason? }
 * - 4 个静默 return 改为 {ok:false, reason} 返回
 * - eventLog.push 仍发生在 apply 前（失败也 push，replay 严格等价）
 * - load() 中坏事件 console.warn 但不 throw
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '../stores/game'

describe('useGameStore / applyEvent 签名与静默失败修复', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('applyEvent 签名返回 {ok, reason?} 而非 void', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({ type: 'dateAdvance', date: '1931-05-01' })
    expect(r).toBeTypeOf('object')
    expect(r).toHaveProperty('ok')
    expect(r.ok).toBe(true)
  })

  it('成功 apply：返回 ok=true，eventLog 长度+1，currentDate 推进', () => {
    const store = useGameStore()
    store.initWorld()
    const lenBefore = store.eventLog.length
    const r = store.applyEvent({ type: 'dateAdvance', date: '1931-05-01' })
    expect(r.ok).toBe(true)
    expect(store.eventLog.length).toBe(lenBefore + 1)
    expect(store.currentDate).toBe('1931-05-01')
  })

  it('【修复点1】capture 目标城不存在：返回 ok=false，eventLog 仍+1（replay 等价），世界态未变', () => {
    const store = useGameStore()
    store.initWorld()
    const lenBefore = store.eventLog.length
    const r = store.applyEvent({
      type: 'capture',
      targetGb: '000000000', // 不存在的 gb
      actor: 'SCC' as any,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('城市不存在')
    // 日志仍追加（replay 严格等价）
    expect(store.eventLog.length).toBe(lenBefore + 1)
    // 世界态：000000000 仍是初始（不存在），不能影响
    expect(store.cities['000000000']).toBeUndefined()
  })

  it('【修复点2】moveTroops 源城不存在：返回 ok=false，eventLog 仍+1', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'moveTroops',
      fromGb: '000000000',
      toGb: '156441400', // 真实存在（梅州市 KMT）
      amount: 5,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('源城不存在')
  })

  it('【修复点3】moveTroops 目标城不存在：返回 ok=false', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'moveTroops',
      fromGb: '156441400',
      toGb: '000000000',
      amount: 5,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('目标城不存在')
  })

  it('【修复点4】moveTroops amount <= 0：返回 ok=false', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'moveTroops',
      fromGb: '156441400',
      toGb: '156420700', // 两座 KMT 城
      amount: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('必须为正')
  })

  it('moveTroops 合法 apply：从源城扣兵，目标城加兵', () => {
    const store = useGameStore()
    store.initWorld()
    // 找两座同势力城市（同属 KMT）
    const same1 = Object.values(store.cities).filter((c) => c.owner === 'KMT')
    expect(same1.length).toBeGreaterThanOrEqual(2)
    const a = same1[0]
    const b = same1[1]
    const beforeA = a.troops
    const beforeB = b.troops
    const r = store.applyEvent({
      type: 'moveTroops',
      fromGb: a.gb,
      toGb: b.gb,
      amount: 3,
    })
    expect(r.ok).toBe(true)
    expect(store.cities[a.gb].troops).toBe(beforeA - 3)
    expect(store.cities[b.gb].troops).toBe(beforeB + 3)
  })

  it('attack 目标城不存在：返回 ok=false', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'attack',
      fromGb: '156500001',
      targetGb: '000000000',
      attackerLoss: 1,
      defenderLoss: 1,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('目标城不存在')
  })

  it('attack 源城不存在（如果 fromGb 提供）：返回 ok=false', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'attack',
      fromGb: '000000000',
      targetGb: '156441400',
      attackerLoss: 1,
      defenderLoss: 1,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('源城不存在')
  })

  it('【关键不变性】坏事件仍 push 到 eventLog（replay 严格等价）', () => {
    const store = useGameStore()
    store.initWorld()
    const lenBefore = store.eventLog.length
    store.applyEvent({ type: 'capture', targetGb: '000000000', actor: 'SCC' as any })
    expect(store.eventLog.length).toBe(lenBefore + 1)
    expect(store.eventLog[store.eventLog.length - 1].type).toBe('capture')
  })

  it('replay 严格等价：坏事件 replay 一次后世界态相同', () => {
    const store = useGameStore()
    store.initWorld()
    // 第一次 apply：坏事件，世界态未变，日志+1
    const r1 = store.applyEvent({ type: 'capture', targetGb: '000000000', actor: 'SCC' as any })
    expect(r1.ok).toBe(false)
    const worldStateBeforeReplay = JSON.stringify(store.cities).length
    const logLenBeforeReplay = store.eventLog.length
    // 模拟 replay：isReplaying=true 时再 apply 一次
    store.isReplaying = true
    const r2 = store.applyEvent({ type: 'capture', targetGb: '000000000', actor: 'SCC' as any })
    store.isReplaying = false
    expect(r2.ok).toBe(false)
    // replay 期间不 push 日志（与 load 行为一致）
    expect(store.eventLog.length).toBe(logLenBeforeReplay)
    // 世界态未变
    expect(JSON.stringify(store.cities).length).toBe(worldStateBeforeReplay)
  })
})

describe('useGameStore / setFactionAlive 等非城市态事件不依赖 preCheck', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setFactionAlive：新增存活', () => {
    const store = useGameStore()
    store.initWorld()
    // 移除 SCC
    const r1 = store.applyEvent({ type: 'setFactionAlive', faction: 'SCC' as any, alive: false })
    expect(r1.ok).toBe(true)
    expect(store.activeFactions.includes('SCC' as any)).toBe(false)
    // 重新加入
    const r2 = store.applyEvent({ type: 'setFactionAlive', faction: 'SCC' as any, alive: true })
    expect(r2.ok).toBe(true)
    expect(store.activeFactions.includes('SCC' as any)).toBe(true)
  })

  it('narrative：纯记录，世界态未变', () => {
    const store = useGameStore()
    store.initWorld()
    const r = store.applyEvent({
      type: 'narrative',
      playerInput: '派兵',
      aiMessage: '已命',
      kind: 'player',
    })
    expect(r.ok).toBe(true)
  })

  it('battleStart / battleEnd：battles 数组管理', () => {
    const store = useGameStore()
    store.initWorld()
    const r1 = store.applyEvent({
      type: 'battleStart',
      battleId: 'battle_test_1',
      fromGb: '156500001',
      targetGb: '156500002',
      fromName: 'A',
      toName: 'B',
    })
    expect(r1.ok).toBe(true)
    expect(store.battles.length).toBe(1)
    const r2 = store.applyEvent({ type: 'battleEnd', battleId: 'battle_test_1' })
    expect(r2.ok).toBe(true)
    expect(store.battles.length).toBe(0)
  })
})
