import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, executeOrder } from '@/utils/gameOrders'
import { checkLiveOrder } from '@/utils/gameplayRules'
import { buildFactionInitiative, buildInitiativeContext } from '@/utils/factionInitiative'
import { buildFactionContext } from '@/utils/aiContext'
import { buildFactionSystemPrompt } from '@/utils/aiPromptBuilder'
import { buildEventHistory } from '@/utils/aiHistory'
import { decideFaction } from '@/utils/ai/factionAi'
import { nextTurnDate } from '@/utils/turnDate'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const zhaotong = '156530600',
  yibin = '156511500'

beforeEach(() => {
  vi.unstubAllGlobals()
  const store = useGameStore()
  store.isReplaying = false
  store.initWorld()
  store.selectFaction(Owner.SCC)
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
})
function war() {
  useGameStore().applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.YUN, status: 'war' })
}
function loseZhaotong() {
  war()
  useGameStore().applyEvent({
    type: 'capture',
    targetGb: zhaotong,
    actor: Owner.SCC,
    resultTroops: 5,
    occupationTurns: 0,
  })
}
describe('read-only faction operational goals', () => {
  it('prioritizes the city under attack with guarded reinforcement examples', async () => {
    expect(
      (await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 })).ok,
    ).toBe(true)
    const store = useGameStore(),
      before = store.getSnapshot()
    const intent = buildFactionInitiative(Owner.YUN)
    expect(intent).toMatchObject({ kind: 'defend', targetGb: zhaotong })
    expect(intent.examples.length).toBeGreaterThan(0)
    expect(
      intent.examples.every(
        (o) => checkLiveOrder(o, { authority: 'faction', actor: Owner.YUN }).ok,
      ),
    ).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
    expect(buildFactionContext(Owner.YUN)).toContain('保住昭通市')
  })
  it('supports existing own frontline instead of reopening the same source', async () => {
    await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 })
    const intent = buildFactionInitiative(Owner.SCC)
    expect(intent.kind).toBe('support')
    expect(intent.examples.every((o) => o.order !== 'battle')).toBe(true)
  })
  it('keeps recent loss as a reachable contested objective, without state mutation', () => {
    loseZhaotong()
    const store = useGameStore(),
      before = store.getSnapshot()
    const intent = buildFactionInitiative(Owner.YUN)
    expect(intent.targetGb).toBe(zhaotong)
    expect(['assemble', 'recapture']).toContain(intent.kind)
    expect(intent.reason).toContain('近期失地')
    expect(store.getSnapshot()).toEqual(before)
  })
  it('does not induce war against peaceful, allied or truce-protected owners', () => {
    const store = useGameStore()
    expect(buildFactionInitiative(Owner.YUN).kind).toBe('hold')
    loseZhaotong()
    store.applyEvent({
      type: 'relationChange',
      a: Owner.SCC,
      b: Owner.YUN,
      status: 'peace',
      truceUntil: '1932-01-01',
    })
    expect(buildFactionInitiative(Owner.YUN).kind).toBe('hold')
    store.applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.YUN, status: 'alliance' })
    expect(buildFactionInitiative(Owner.YUN).kind).toBe('hold')
  })
  it('does not suggest paid orders at zero action points', () => {
    loseZhaotong()
    const store = useGameStore()
    store.applyEvent({ type: 'actionSpent', faction: Owner.YUN, amount: 6 })
    expect(buildFactionInitiative(Owner.YUN)).toMatchObject({ kind: 'hold', examples: [] })
  })
  it('only suggests guarded recapture with a retained source garrison', () => {
    loseZhaotong()
    const store = useGameStore()
    for (const city of Object.values(store.cities).filter((c) => c.owner === Owner.YUN))
      store.applyEvent({ type: 'produce', targetGb: city.gb, amount: 10 })
    const intent = buildFactionInitiative(Owner.YUN)
    expect(intent.kind).toBe('recapture')
    expect(intent.targetGb).toBe(zhaotong)
    const attack = intent.examples[0]!
    expect(attack.order).toBe('battle')
    expect(checkLiveOrder(attack, { authority: 'faction', actor: Owner.YUN }).ok).toBe(true)
    expect(store.cities[attack.from!]!.troops - attack.deployAmount!).toBeGreaterThanOrEqual(2)
    expect(intent.reason).toContain('不是胜率或胜利保证')
  })
  it('expires old loss priority and removes it after recapture', () => {
    loseZhaotong()
    const store = useGameStore()
    for (let i = 0; i < 7; i++)
      store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
    expect(buildFactionInitiative(Owner.YUN).reason).not.toContain('近期失地')
    store.applyEvent({
      type: 'capture',
      targetGb: zhaotong,
      actor: Owner.YUN,
      resultTroops: 5,
      occupationTurns: 0,
    })
    expect(buildFactionInitiative(Owner.YUN).targetGb).not.toBe(zhaotong)
  })
  it('prioritizes consolidation of a newly taken supplied city', () => {
    war()
    useGameStore().applyEvent({
      type: 'capture',
      targetGb: zhaotong,
      actor: Owner.SCC,
      resultTroops: 5,
      occupationTurns: 2,
    })
    const intent = buildFactionInitiative(Owner.SCC)
    expect(intent).toMatchObject({ kind: 'consolidate', targetGb: zhaotong })
    expect(intent.examples.every((o) => o.order !== 'battle')).toBe(true)
  })
  it('calls out an isolated frontier before offering a new attack', () => {
    war()
    const store = useGameStore()
    for (const city of Object.values(store.cities).filter(
      (c) => c.owner === Owner.YUN && c.gb !== zhaotong,
    ))
      store.applyEvent({
        type: 'capture',
        targetGb: city.gb,
        actor: Owner.SCC,
        resultTroops: 5,
        occupationTurns: 0,
      })
    const before = store.getSnapshot()
    const intent = buildFactionInitiative(Owner.YUN)
    expect(intent).toMatchObject({ kind: 'restore-supply', targetGb: zhaotong })
    expect(intent.examples.every((o) => o.order !== 'battle')).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
  })
  it('does not offer unaffordable economic actions', () => {
    loseZhaotong()
    const store = useGameStore()
    store.applyEvent({
      type: 'treasuryChange',
      faction: Owner.YUN,
      delta: -store.getTreasury(Owner.YUN),
    })
    store.applyEvent({
      type: 'granaryChange',
      faction: Owner.YUN,
      delta: -store.getGranary(Owner.YUN),
    })
    const intent = buildFactionInitiative(Owner.YUN)
    expect(
      intent.examples.some((o) => ['recruit', 'fortify', 'rally', 'develop'].includes(o.order)),
    ).toBe(false)
    expect(
      intent.examples.every(
        (o) => checkLiveOrder(o, { authority: 'faction', actor: Owner.YUN }).ok,
      ),
    ).toBe(true)
  })
  it('does not confuse historical refusal balance with current resources', () => {
    const store = useGameStore()
    store.applyEvent({
      type: 'commandReceipt',
      faction: Owner.YUN,
      label: 'recruit 昭通 数量100',
      ok: false,
      reason: '银粮不足',
      spentPoints: 0,
      spentSilver: 0,
      spentFood: 0,
      remainingPoints: 0,
      remainingSilver: 0,
      remainingFood: 0,
    })
    const text = buildInitiativeContext(Owner.YUN)
    expect(text).toContain('近期未执行')
    expect(text).toContain('当前预算以上方现状为准')
    expect(text).toContain('不原样重复失败计划')
  })
})

describe('event-time faction memory and pre-execution feedback', () => {
  it('retains lost-city capture and original domestic owner after ownership changes', () => {
    const store = useGameStore()
    store.applyEvent({ type: 'produce', targetGb: zhaotong, amount: 2 })
    loseZhaotong()
    store.applyEvent({ type: 'produce', targetGb: zhaotong, amount: 3 })
    const history = buildEventHistory({ mode: 'byActor', actor: Owner.YUN, maxChars: 3000 })
    expect(history).toContain('增兵 2k')
    expect(history).not.toContain('增兵 3k')
    expect(history).toContain('占领 昭通市 → SCC')
    expect(buildEventHistory({ mode: 'byActor', actor: Owner.SCC })).toContain('增兵 3k')
  })
  it('reports attack/defense losses neutrally and bounds history by maxEvents', () => {
    const store = useGameStore()
    store.applyEvent({
      type: 'attack',
      fromGb: yibin,
      targetGb: zhaotong,
      attackerLoss: 1,
      defenderLoss: 1,
    })
    const text = buildEventHistory({ mode: 'byActor', actor: Owner.YUN })
    expect(text).toContain('攻损 1k / 守损 1k')
    expect(text).not.toContain('我损')
    for (let i = 0; i < 4; i++)
      store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
    expect(
      buildEventHistory({ mode: 'byActor', actor: Owner.YUN, maxEvents: 2 }).split('\n'),
    ).toHaveLength(2)
  })
  it('persists trusted zero-cost refusals before the scheduler and exposes them to the next decision', async () => {
    const store = useGameStore()
    const home = Object.values(store.cities).find(
      (c) => c.owner === Owner.YUN && c.gb !== zhaotong,
    )!
    const payload = {
      msg: '测试预检',
      orders: [
        { order: 'capture', gb: yibin, owner: Owner.YUN },
        { order: 'recruit', gb: yibin, amount: 1, actor: Owner.SCC },
        { order: 'move', from: home.name, to: '不存在', amount: 1 },
        { order: 'recruit', from: home.name, amount: 1 },
        { order: 'recruit', gb: home.name, amount: 1 },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<object>>().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      }),
    )
    const before = store.getSnapshot()
    const decision = await decideFaction(Owner.YUN, buildFactionContext(Owner.YUN))
    expect(decision.orders).toHaveLength(1)
    const receipts = store.eventLog.filter((e) => e.type === 'commandReceipt')
    expect(receipts).toHaveLength(4)
    expect(
      receipts.every(
        (e) =>
          e.faction === Owner.YUN &&
          !e.ok &&
          e.spentPoints === 0 &&
          e.spentSilver === 0 &&
          e.spentFood === 0,
      ),
    ).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
    expect(buildFactionContext(Owner.YUN)).toContain('结构预检拒绝')
    expect(buildFactionContext(Owner.YUN)).toContain('战略预检拒绝')
    expect(buildFactionSystemPrompt(Owner.YUN)).toContain('必须是 gb，不能写成 from')
    store.save('refusal-history')
    expect(store.load('refusal-history')).toBe(true)
    expect(store.eventLog.filter((e) => e.type === 'commandReceipt')).toEqual(receipts)
  })
})
