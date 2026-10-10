import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, executeOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { computeBaseBattle } from '@/utils/battleFormula'
import { previewCampaign } from '@/utils/campaignPreview'
import { checkLiveOrder } from '@/utils/gameplayRules'
import { buildFactionInitiative, buildInitiativeContext } from '@/utils/factionInitiative'
import {
  compareBattle,
  assessCampaign,
  assessActiveBattle,
  affordableCampaign,
  tacticalText,
  setbackAdvice,
} from '@/utils/tacticalAssessment'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const yibin = '156511500',
  zhaotong = '156530600'
const base = {
  atkForce: 200,
  defTroops: 100,
  atkMorale: 70,
  defMorale: 70,
  fort: 0,
  terrain: 'PLAIN',
  distanceFactor: 1,
  remainingGarrison: 10,
  supplied: true,
  silver: 20,
  food: 15,
}
function setBudget(silver: number, food: number) {
  const store = useGameStore()
  // Respect the event magnitude clamp rather than assuming one huge delta lands.
  while (store.getTreasury(Owner.SCC) > silver)
    store.applyEvent({
      type: 'treasuryChange',
      faction: Owner.SCC,
      delta: -Math.min(100, store.getTreasury(Owner.SCC) - silver),
    })
  while (store.getGranary(Owner.SCC) > food)
    store.applyEvent({
      type: 'granaryChange',
      faction: Owner.SCC,
      delta: -Math.min(100, store.getGranary(Owner.SCC) - food),
    })
}
beforeEach(() => {
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
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
})
describe('one-settlement tactical comparison', () => {
  it('uses the existing base loss and morale formula, not a second power formula', () => {
    const expected = computeBaseBattle(base),
      value = compareBattle(base)
    expect(value.attackerLoss).toBe(expected.attackerLoss)
    expect(value.defenderLoss).toBe(expected.defenderLoss)
    expect(value.attackerMoraleAfter).toBe(base.atkMorale + expected.atkMoraleDelta)
    expect(tacticalText(value)).toContain('不是胜率或胜利保证')
  })
  it('higher fort reduces baseline defender loss', () => {
    expect(compareBattle({ ...base, fort: 100 }).defenderLoss).toBeLessThan(
      compareBattle(base).defenderLoss,
    )
  })
  it('mountain terrain increases baseline attacker loss', () => {
    expect(compareBattle({ ...base, terrain: 'MOUNTAIN' }).attackerLoss).toBeGreaterThan(
      compareBattle(base).attackerLoss,
    )
  })
  it('distance/supply decay reduces baseline defender loss', () => {
    expect(
      compareBattle({ ...base, distanceFactor: 0.4, supplied: false }).defenderLoss,
    ).toBeLessThan(compareBattle(base).defenderLoss)
    expect(compareBattle({ ...base, supplied: false }).risk).toBe('consider')
  })
  it('calls out low morale without claiming a collapse will happen', () => {
    const value = compareBattle({ ...base, atkMorale: 10 })
    expect(value.risk).toBe('high')
    expect(value.reasons.join('')).toContain('不代表必然崩溃')
  })
  it('tiny forces respect the settlement cap instead of forecasting negative troops', () => {
    const value = compareBattle({ ...base, atkForce: 0.1, defTroops: 0.2 })
    expect(value.attackerLoss).toBe(0.1)
    expect(value.defenderLoss).toBe(0.2)
    expect(value.risk).toBe('high')
  })
  it('an empty defender has no invented attrition forecast', () => {
    expect(compareBattle({ ...base, defTroops: 0 })).toMatchObject({
      attackerLoss: 0,
      defenderLoss: 0,
    })
  })
  it('calls out thin source defense independently of a good damage exchange', () => {
    const value = compareBattle({ ...base, remainingGarrison: 0 })
    expect(value.risk).toBe('consider')
    expect(value.reasons.join('')).toContain('留守不足')
  })
})
describe('guarded previews, budgets and existing fronts', () => {
  it('legal risk is advisory and forecast does not mutate or spend', () => {
    const store = useGameStore(),
      before = store.getSnapshot()
    const preview = previewCampaign(yibin, zhaotong, 1)
    expect(preview.ok).toBe(true)
    expect(assessCampaign(preview)?.risk).toBe('high')
    expect(checkLiveOrder(preview.order).ok).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
  })
  it('a larger preview preserves its actual fee and remaining source troops', () => {
    const preview = previewCampaign(yibin, zhaotong, 6)
    expect(assessCampaign(preview)).toMatchObject({
      remainingGarrison: 2,
      silver: preview.silver,
      food: preview.food,
    })
  })
  it('shrinks only unaffordable campaigns to the largest guarded tenth-k amount', () => {
    const store = useGameStore()
    setBudget(8, 8)
    expect(store.getTreasury(Owner.SCC)).toBe(8)
    const before = store.getSnapshot()
    const result = affordableCampaign(yibin, zhaotong, 6, 'battle', Owner.SCC)
    expect(result.ok).toBe(true)
    expect(result.order.deployAmount).toBeLessThan(6)
    expect(checkLiveOrder(result.order).ok).toBe(true)
    expect(previewCampaign(yibin, zhaotong, result.order.deployAmount! + 0.1).ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
  })
  it('cannot resize around a protected truce or missing route', () => {
    const store = useGameStore()
    store.applyEvent({
      type: 'relationChange',
      a: Owner.SCC,
      b: Owner.YUN,
      status: 'peace',
      truceUntil: '1932-01-01',
    })
    const protectedAttack = affordableCampaign(yibin, zhaotong, 6, 'battle', Owner.SCC)
    expect(protectedAttack.ok).toBe(false)
    expect(protectedAttack.order.deployAmount).toBe(6)
    expect(assessCampaign(protectedAttack)).toBeNull()
    expect(affordableCampaign(yibin, 'missing', 6, 'battle', Owner.SCC).ok).toBe(false)
  })
  it('zero money or zero points does not generate a free reduced campaign', () => {
    const store = useGameStore()
    setBudget(0, 0)
    expect(affordableCampaign(yibin, zhaotong, 6, 'battle', Owner.SCC).ok).toBe(false)
    store.applyEvent({ type: 'actionSpent', faction: Owner.SCC, amount: 6 })
    expect(affordableCampaign(yibin, zhaotong, 6, 'battle', Owner.SCC).ok).toBe(false)
  })
  it('a numerical troop advantage alone does not recommend attacking a hardened loss target', () => {
    const store = useGameStore()
    store.applyEvent({ type: 'relationChange', a: Owner.SCC, b: Owner.YUN, status: 'war' })
    store.applyEvent({ type: 'capture', targetGb: zhaotong, actor: Owner.SCC, resultTroops: 40, occupationTurns: 0 })
    store.applyEvent({ type: 'cityStatChange', targetGb: zhaotong, field: 'fort', delta: 70 })
    const source = Object.values(store.cities).find(c => c.owner === Owner.YUN && c.name === '昆明市')!
    store.applyEvent({ type: 'produce', targetGb: source.gb, amount: 80 - source.troops })
    const intent = buildFactionInitiative(Owner.YUN)
    expect(intent).toMatchObject({ kind: 'assemble', targetGb: zhaotong })
    expect(intent.reason).toContain('需要权衡')
    expect(intent.examples.every(o => o.order !== 'battle')).toBe(true)
  })
  it('active forecast matches the next no-flavor settlement and does not charge sunk march costs', async () => {
    useGameStore().applyEvent({ type: 'produce', targetGb: zhaotong, amount: 5 })
    await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 })
    const store = useGameStore(),
      before = store.getSnapshot()
    const forecast = assessActiveBattle(store.battles[0]!)!
    expect(forecast).toMatchObject({ silver: 0, food: 0 })
    expect(store.getSnapshot()).toEqual(before)
    const attackers = store.cities[yibin]!.fieldForce,
      defenders = store.cities[zhaotong]!.troops
    await useGameScheduler().settleActiveBattles()
    expect(attackers - store.cities[yibin]!.fieldForce).toBe(forecast.attackerLoss)
    expect(defenders - store.cities[zhaotong]!.troops).toBe(forecast.defenderLoss)
  })
  it('offers a normal retreat at zero points without executing it automatically', async () => {
    await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 })
    const store = useGameStore()
    store.applyEvent({
      type: 'actionSpent',
      faction: Owner.SCC,
      amount: store.getActionPoints(Owner.SCC),
    })
    const before = store.getSnapshot(),
      intent = buildFactionInitiative(Owner.SCC)
    expect(intent.examples).toHaveLength(1)
    expect(intent.examples[0]!.order).toBe('stopBattle')
    expect(store.battles[0]!.active).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
    expect(
      (await executeOrder(intent.examples[0]!, { authority: 'faction', actor: Owner.SCC })).ok,
    ).toBe(true)
    expect(store.getActionPoints(Owner.SCC)).toBe(0)
    expect(store.battles.some((b) => b.active)).toBe(false)
  })
  it('restored state preserves the same read-only battle assessment', async () => {
    await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 6 })
    const store = useGameStore(),
      forecast = assessActiveBattle(store.battles[0]!)
    store.save('tactics')
    expect(store.load('tactics')).toBe(true)
    expect(assessActiveBattle(store.battles[0]!)).toEqual(forecast)
  })
  it('preserves legacy no-supply-penalty battle semantics', async () => {
    const store = useGameStore()
    for (const city of Object.values(store.cities).filter(
      (c) => c.owner === Owner.SCC && c.gb !== yibin,
    ))
      store.applyEvent({
        type: 'capture',
        targetGb: city.gb,
        actor: Owner.NEUTRAL,
        resultTroops: 5,
        occupationTurns: 0,
      })
    store.applyEvent({ type: 'produce', targetGb: yibin, amount: 200 })
    store.applyEvent({ type: 'produce', targetGb: zhaotong, amount: 100 })
    await executeOrder({ order: 'battle', from: yibin, to: zhaotong, deployAmount: 100 })
    const battle = store.battles[0]!
    const current = assessActiveBattle(battle)!,
      legacy = assessActiveBattle({ ...battle, supplyRulesVersion: undefined })!
    expect(current.defenderLoss).toBeLessThan(legacy.defenderLoss)
    expect(current.reasons.join('')).toContain('断供')
    expect(legacy.reasons.join('')).not.toContain('断供')
  })
})
describe('cause-specific setbacks', () => {
  it.each([
    ['结构预检拒绝：gb undefined', '必填字段'],
    ['远征银粮不足', '重算整批费用'],
    ['行动点不足', '等待行动点'],
    ['停战期不可再战', '外交限制'],
    ['没有合法连接路线', '减少兵力不能修复'],
  ])('explains %s without a bypass', (reason, expected) => {
    expect(setbackAdvice(reason)).toContain(expected)
  })
  it('makes the actual refusal cause available to subsequent context', () => {
    const store = useGameStore()
    store.applyEvent({
      type: 'commandReceipt',
      faction: Owner.SCC,
      label: 'battle 宜宾 → 昭通',
      ok: false,
      reason: '远征银粮不足',
      spentPoints: 0,
      spentSilver: 0,
      spentFood: 0,
      remainingPoints: 6,
      remainingSilver: 1,
      remainingFood: 1,
    })
    expect(buildInitiativeContext(Owner.SCC)).toContain('重算整批费用')
  })
})
