import type { GameOrder } from './gameOrders'
import type { Owner } from '@/data/owners'
import type { GameEvent } from '@/stores/game'
import { round1 } from './format'

export interface BudgetSnapshot { points: number; silver: number; food: number }
export type CommandReceipt = Extract<GameEvent, { type: 'commandReceipt' }>

/** Caller supplies identity and observed balances; never trust model actor/cost. */
export function commandReceipt(
  faction: Owner, order: GameOrder, result: { ok: boolean; reason?: string },
  before: BudgetSnapshot, after: BudgetSnapshot,
): CommandReceipt {
  const places = [order.from, order.to, order.gb].filter(Boolean).join(' → ')
  const amount = order.amount ?? order.deployAmount
  const label = [order.order, places, amount === undefined ? '' : `数量${amount}`].filter(Boolean).join(' ').slice(0, 160)
  return {
    type: 'commandReceipt', faction, label, ok: result.ok,
    reason: result.reason?.slice(0, 240),
    spentPoints: Math.max(0, before.points - after.points),
    spentSilver: round1(Math.max(0, before.silver - after.silver)),
    spentFood: round1(Math.max(0, before.food - after.food)),
    remainingPoints: after.points, remainingSilver: after.silver, remainingFood: after.food,
  }
}

export function receiptText(receipt: CommandReceipt): string {
  return `${receipt.ok ? '已执行' : '未执行'} ${receipt.label}${receipt.reason ? `：${receipt.reason}` : ''}；实耗${receipt.spentPoints}行动点/银${receipt.spentSilver}/粮${receipt.spentFood}；余${receipt.remainingPoints}点/银${receipt.remainingSilver}/粮${receipt.remainingFood}`
}

export interface ChatFeedback {
  msg: string | null
  orders: string[]
  validationSummary?: string
  rejected?: { label: string; reason: string }[]
  impossible?: { label: string; reason: string; suggestion?: string }[]
}

/** Keep failures/statuses in subsequent conversation, not just model narration. */
export function chatFeedbackText(entry: ChatFeedback): string {
  const failures = [...(entry.rejected ?? []), ...(entry.impossible ?? [])]
    .map(r => `未执行 ${r.label}：${r.reason}`)
  return [
    entry.msg ?? '', entry.validationSummary ?? '',
    entry.orders.length ? `执行层回执：[${entry.orders.join('；')}]` : '',
    ...failures,
  ].filter(Boolean).join('\n')
}
