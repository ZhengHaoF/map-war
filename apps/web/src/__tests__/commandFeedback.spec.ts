import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { commandReceipt, chatFeedbackText, receiptText } from '@/utils/commandFeedback'
import { buildEventHistory } from '@/utils/aiHistory'
import { describeEvent, eventBadge, isRoutineEvent } from '@/utils/eventDescribe'

beforeEach(() => useGameStore().initWorld())
describe('trusted command feedback', () => {
  it('uses observed balance changes, not model actor or a claimed free action', () => {
    const receipt = commandReceipt(Owner.SCC, { order: 'recruit', gb: '宜宾', amount: 2, actor: Owner.KMT } as never,
      { ok: true }, { points: 6, silver: 1200, food: 720 }, { points: 5, silver: 1196, food: 718 })
    expect(receipt).toMatchObject({ faction: Owner.SCC, spentPoints: 1, spentSilver: 4, spentFood: 2 })
    expect(receiptText(receipt)).toContain('已执行')
    expect(describeEvent(receipt, {})).toContain('川军')
    expect(eventBadge(receipt)).toBe('回执')
    expect(isRoutineEvent(receipt)).toBe(true)
  })
  it('does not falsely promise that an exception spent nothing', () => {
    const receipt = commandReceipt(Owner.SCC, { order: 'recruit', gb: '宜宾', amount: 2 },
      { ok: false, reason: '执行异常，未完成' },
      { points: 6, silver: 1200, food: 720 }, { points: 6, silver: 1196, food: 718 })
    expect(receipt).toMatchObject({ ok: false, spentPoints: 0, spentSilver: 4, spentFood: 2 })
    expect(receiptText(receipt)).toContain('未执行')
  })
  it('preserves rejected statuses/reasons and validation in subsequent chat', () => {
    const text = chatFeedbackText({ msg: '大军已开拔', orders: ['battle：无合法进攻路线 ✗'],
      validationSummary: '已执行0条', rejected: [{ label: 'capture', reason: '系统管理' }],
      impossible: [{ label: 'battle', reason: '银粮不足' }] })
    expect(text).toContain('✗')
    expect(text).toContain('无合法进攻路线')
    expect(text).toContain('未执行 capture：系统管理')
    expect(text).toContain('银粮不足')
  })
  it('is read-only during replay and scoped to the correct faction history', () => {
    const store = useGameStore()
    const snapshot = store.getSnapshot()
    const budget = { points: 0, silver: 12, food: 8 }
    store.applyEvent(commandReceipt(Owner.SCC, { order: 'recruit', gb: '宜宾', amount: 2 },
      { ok: false, reason: '回合行动点不足' }, budget, budget))
    expect(store.getSnapshot()).toEqual(snapshot)
    expect(buildEventHistory({ mode: 'byActor', actor: Owner.SCC })).toContain('回合行动点不足')
    expect(buildEventHistory({ mode: 'byActor', actor: Owner.KMT })).not.toContain('回合行动点不足')
    expect(buildEventHistory({ mode: 'recent' })).toContain('执行层回执')
  })
})
