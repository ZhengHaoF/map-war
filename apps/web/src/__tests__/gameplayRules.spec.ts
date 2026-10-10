import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { executeOrder, init, resetBattleRuntime, playTimeJump } from '@/utils/gameOrders'
import { executeBoundedFreeEffect } from '@/utils/freeActionExecution'
import { useAiOrchestrator } from '@/composables/useAiOrchestrator'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { clampFlavor } from '@/utils/battleFormula'
import { ACTION_POINTS_PER_TURN } from '@/data/gameConfig'
import { describeEvent } from '@/utils/eventDescribe'
import raw from '@/data/chinaCities.seed.json'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => { graphics: object; stop: () => void }>(() => ({ graphics: {}, stop: vi.fn<() => void>() })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/cloudTransition', () => ({ playCloudTransition: vi.fn<(_app: unknown, opts?: { onMidpoint?: () => void }) => Promise<void>>(async (_app, opts) => opts?.onMidpoint?.()) }))
vi.mock('@/utils/ai', () => ({ sendTelegram: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]), flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}) }))

function reply(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn<() => Promise<object>>().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  }))
}
function cities() {
  const store = useGameStore()
  return {
    store,
    home: Object.values(store.cities).find(c => c.owner === Owner.SCC)!,
    enemy: Object.values(store.cities).find(c => c.owner === Owner.KMT)!,
  }
}
beforeEach(() => {
  vi.unstubAllGlobals()
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
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
})

describe('live command boundaries', () => {
  it('names the depleted resource as turn action points and explains recovery', () => {
    const { store } = cities()
    store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: ACTION_POINTS_PER_TURN })
    expect(store.checkAction(Owner.SCC)).toEqual({ ok: false, reason: '回合行动点不足，请结束回合恢复' })
    expect(store.checkAction(Owner.SCC, 0).reason).toBe('回合行动点必须为正整数')
  })
  it('uses turn action point terminology for spending and refunds in the event log', () => {
    for (const type of ['actionSpent', 'actionRefunded'] as const) {
      const text = describeEvent({ type, faction: Owner.SCC, amount: 1 }, {})
      expect(text).toContain('回合行动点')
      expect(text).not.toContain('额度')
    }
  })
  it.each(['player', 'faction'] as const)('rejects direct capture for %s without changing city or resources', async authority => {
    const { store, enemy } = cities()
    const before = store.getSnapshot()
    const r = await executeOrder({ order: 'capture', gb: enemy.gb, owner: Owner.SCC }, { authority, actor: Owner.SCC })
    expect(r.ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
  })
  it('does not trust authority or actor supplied in model JSON', async () => {
    const { enemy } = cities()
    const r = await executeOrder({ order: 'capture', gb: enemy.gb, owner: Owner.SCC, authority: 'system' } as any)
    expect(r.ok).toBe(false)
  })
  it('retains explicit debug capture for developer tools', async () => {
    const { store, enemy } = cities()
    expect((await executeOrder({ order: 'capture', gb: enemy.gb, owner: Owner.SCC }, { authority: 'debug' })).ok).toBe(true)
    expect(store.cities[enemy.gb].owner).toBe(Owner.SCC)
  })
  it('scheduler rejects player date changes but permits trusted system advancement', async () => {
    const { store } = cities()
    const scheduler = useGameScheduler()
    scheduler.submit([{ order: 'setCurrentDate', date: '1940-01-01' }])
    await scheduler.advance()
    expect(store.currentDate).toBe('1931-04-01')
    scheduler.submit([{ order: 'setCurrentDate', date: '1931-04-08' }], { authority: 'system' })
    await scheduler.advance()
    expect(store.currentDate).toBe('1931-04-08')
  })
  it.each([true, false])('time jump commits exactly once when visual midpoint runs=%s', async fires => {
    const { playCloudTransition } = await import('@/utils/cloudTransition')
    vi.mocked(playCloudTransition).mockImplementationOnce(async (_app, opts) => {
      if (fires) await opts?.onMidpoint?.()
    })
    const { store } = cities()
    await playTimeJump('1931-04-08')
    expect(store.currentDate).toBe('1931-04-08')
    expect(store.turnCount).toBe(1)
    expect(store.eventLog.filter(e => e.type === 'dateAdvance')).toHaveLength(1)
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN)
  })
  it('persists partial batch outcomes, actual cumulative budget and failed seventh action', async () => {
    const { store, home } = cities()
    const beforeSilver = store.getTreasury(Owner.SCC)
    const scheduler = useGameScheduler()
    scheduler.submit(Array.from({ length: 7 }, () => ({ order: 'recruit' as const, gb: home.gb, amount: 1 })))
    await scheduler.advance()
    const receipts = store.eventLog.filter(e => e.type === 'commandReceipt')
    expect(receipts).toHaveLength(7)
    expect(receipts.filter(e => e.ok)).toHaveLength(6)
    expect(receipts[6]).toMatchObject({ ok: false, spentPoints: 0, spentSilver: 0, spentFood: 0, remainingPoints: 0 })
    expect(receipts[6].reason).toContain('回合行动点不足')
    expect(receipts.reduce((sum, e) => sum + e.spentSilver, 0)).toBe(12)
    expect(store.getTreasury(Owner.SCC)).toBe(beforeSilver - 12)
    const snapshot = store.getSnapshot()
    expect(store.save('receipt-regression')).toBe(true)
    expect(store.load('receipt-regression')).toBe(true)
    expect(store.getSnapshot()).toEqual(snapshot)
    expect(store.eventLog.filter(e => e.type === 'commandReceipt')).toEqual(receipts)
  })
  it('checks the aggregate silver budget after earlier orders and records faction identity', async () => {
    const { store, home } = cities()
    while (store.getTreasury(Owner.SCC) > 25) {
      store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -Math.min(500, store.getTreasury(Owner.SCC) - 25) })
    }
    const scheduler = useGameScheduler()
    scheduler.submit([
      { order: 'recruit', gb: home.gb, amount: 10 },
      { order: 'recruit', gb: home.gb, amount: 10 },
    ], { authority: 'faction', actor: Owner.SCC })
    await scheduler.advance()
    const receipts = store.eventLog.filter(e => e.type === 'commandReceipt')
    expect(receipts.map(e => e.ok)).toEqual([true, false])
    expect(receipts[0]).toMatchObject({ faction: Owner.SCC, spentSilver: 20, remainingSilver: 5 })
    expect(receipts[1]).toMatchObject({ spentSilver: 0, spentPoints: 0, remainingPoints: 5 })
    expect(receipts[1].reason).toContain('银粮不足')
    expect(store.getTreasury(Owner.SCC)).toBe(5)
  })
  it('truce is checked before deployment, payment, or action reservation', async () => {
    const { store, home, enemy } = cities()
    store.applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.KMT, status: 'peace', truceUntil: '1932-01-01' })
    const before = store.getSnapshot()
    expect((await executeOrder({ order: 'battle', from: home.gb, to: enemy.gb })).ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN)
  })
  it('reserves before async execution and blocks a seventh domestic action', async () => {
    const { store, home } = cities()
    for (let i = 0; i < ACTION_POINTS_PER_TURN; i++) expect((await executeOrder({ order: 'recruit', gb: home.gb, amount: 1 })).ok).toBe(true)
    const troops = store.cities[home.gb].troops
    expect((await executeOrder({ order: 'recruit', gb: home.gb, amount: 1 })).ok).toBe(false)
    expect(store.cities[home.gb].troops).toBe(troops)
    expect(store.getActionPoints(Owner.SCC)).toBe(0)
  })
  it('allows an AI faction to act only through trusted caller identity and charges its own budget', async () => {
    const { store, enemy } = cities()
    expect((await executeOrder({ order: 'recruit', gb: enemy.gb, amount: 1 })).ok).toBe(false)
    expect((await executeOrder({ order: 'recruit', gb: enemy.gb, amount: 1 }, { authority: 'faction', actor: Owner.KMT })).ok).toBe(true)
    expect(store.getActionPoints(Owner.KMT)).toBe(ACTION_POINTS_PER_TURN - 1)
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN)
  })
  it('invalid or unaffordable commands do not consume points or deploy soldiers', async () => {
    const { store, home, enemy } = cities()
    for (const amount of [0, Infinity, NaN, 101]) expect((await executeOrder({ order: 'recruit', gb: home.gb, amount })).ok).toBe(false)
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -500 })
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -500 })
    store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -200 })
    const troops = store.cities[home.gb].troops
    expect((await executeOrder({ order: 'battle', from: home.gb, to: enemy.gb })).ok).toBe(false)
    expect(store.cities[home.gb].troops).toBe(troops)
    expect(store.cities[home.gb].fieldForce).toBe(0)
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN)
  })
  it('cannot command withdrawal of an opposing attacker', async () => {
    const { store, home, enemy } = cities()
    store.applyEvent({ type: 'battleStart', battleId: 'enemy-front', fromGb: enemy.gb, targetGb: home.gb,
      fromName: enemy.name, toName: home.name, attacker: Owner.KMT, defender: Owner.SCC })
    expect((await executeOrder({ order: 'stopBattle', id: 'enemy-front' })).ok).toBe(false)
    expect(store.battles).toHaveLength(1)
  })
})

describe('free action budget and replay', () => {
  it('repeated propaganda only affects the same target once and pays the silver cost', () => {
    const { store, enemy } = cities()
    const before = store.cities[enemy.gb].morale
    const silver = store.getTreasury(Owner.SCC)
    const effect = { type: 'moraleChange' as const, targetGb: enemy.gb, delta: -10 }
    expect(executeBoundedFreeEffect(effect, '宣传').ok).toBe(true)
    for (let i = 0; i < 6; i++) expect(executeBoundedFreeEffect(effect, '不同说法').ok).toBe(false)
    expect(store.cities[enemy.gb].morale).toBe(before - 10)
    expect(store.getTreasury(Owner.SCC)).toBe(silver - 10)
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN - 1)
  })
  it('city alias and another sabotage field do not bypass the target cooldown', () => {
    const { enemy } = cities()
    expect(executeBoundedFreeEffect({ type: 'moraleChange', targetGb: enemy.gb, delta: -10 }, '宣传').ok).toBe(true)
    expect(executeBoundedFreeEffect({ type: 'cityStatChange', targetGb: enemy.name, field: 'fort', delta: -10 }, '谍报').ok).toBe(false)
  })
  it('fundraising gains at most 50 per turn even with repeated or excessive model output', () => {
    const { store } = cities()
    const before = store.getTreasury(Owner.SCC)
    const effect = { type: 'treasuryChange' as const, faction: '川军', delta: 999 }
    expect(executeBoundedFreeEffect(effect, '筹饷').ok).toBe(true)
    expect(executeBoundedFreeEffect(effect, '再筹饷').ok).toBe(false)
    expect(store.getTreasury(Owner.SCC)).toBe(before + 50)
  })
  it('cannot forge third-party treasury or unilateral peace/alliance', () => {
    expect(executeBoundedFreeEffect({ type: 'treasuryChange', faction: '国民政府', delta: -50 }, '扣敌方银').ok).toBe(false)
    for (const status of ['peace', 'alliance'] as const) {
      expect(executeBoundedFreeEffect({ type: 'relationChange', a: '川军', b: '国民政府', status }, '强制签约').ok).toBe(false)
    }
  })
  it('read/save/reload preserves remaining points and cooldowns', () => {
    const { store, enemy } = cities()
    const effect = { type: 'moraleChange' as const, targetGb: enemy.gb, delta: -10 }
    executeBoundedFreeEffect(effect, '宣传')
    expect(store.save('rule-review')).toBe(true)
    expect(store.load('rule-review')).toBe(true)
    store.isReplaying = false
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN - 1)
    expect(executeBoundedFreeEffect(effect, '读档重复').ok).toBe(false)
  })
  it('new date resets points and cooldowns; invalid reservations replay as invalid', () => {
    const { store } = cities()
    store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: ACTION_POINTS_PER_TURN, key: 'test' })
    expect(store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: 1 }).ok).toBe(false)
    store.save('invalid-reservation')
    store.load('invalid-reservation')
    store.isReplaying = false
    expect(store.getActionPoints(Owner.SCC)).toBe(0)
    store.applyEvent({ type: 'dateAdvance', date: '1931-04-08' })
    expect(store.getActionPoints(Owner.SCC)).toBe(ACTION_POINTS_PER_TURN)
    expect(store.checkAction(Owner.SCC, 1, 'test').ok).toBe(true)
  })
  it('orchestrator counts only applied effects and limits one response to three effects', async () => {
    const { store } = cities()
    reply({ msg: '筹饷', freeAction: { narrative: '筹集', success: true, effects: Array.from({ length: 10 }, () => ({
      type: 'treasuryChange', faction: '川军', delta: 50,
    })) } })
    const agent = useAiOrchestrator('user')
    agent.userMessage.value = '筹饷'
    await agent.runSend()
    expect(agent.freeActionResult.value?.effects).toHaveLength(1)
    expect(agent.freeActionResult.value?.narrative).toContain('最多')
    expect(store.getTreasury(Owner.SCC)).toBe(1250)
  })
  it('filtering a rejected first order does not execute a later impossible order', async () => {
    const { home } = cities()
    reply({ msg: '计划', results: [
      { order: { order: 'capture', gb: '北京', owner: '川军' }, verdict: 'feasible' },
      { order: { order: 'recruit', gb: home.gb, amount: 1 }, verdict: 'impossible', reason: '不可行' },
    ] })
    const agent = useAiOrchestrator('user')
    agent.userMessage.value = '执行计划'
    await agent.runSend()
    agent.applyStrategicRules()
    expect(agent.getFinalApprovedOrders()).toHaveLength(0)
  })
  it('battle flavor has aggregate side caps, not merely per-event caps', () => {
    const output = clampFlavor({ events: [
      ...Array.from({ length: 5 }, () => ({ type: 'morale' as const, side: 'defender' as const, delta: -20 })),
      ...Array.from({ length: 5 }, () => ({ type: 'shock' as const, side: 'attacker' as const, magnitude: 5 })),
    ] }, { attackerLoss: 10, defenderLoss: 10, atkMoraleDelta: -3, defMoraleDelta: -3 })
    expect(output.events.reduce((s, e) => s + (e.delta ?? 0), 0)).toBe(-20)
    expect(output.events.reduce((s, e) => s + (e.magnitude ?? 0), 0)).toBe(5)
  })
})
