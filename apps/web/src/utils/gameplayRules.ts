/** Live-command trust boundary. Replay and battle adjudication use events instead. */
import { useGameStore } from '@/stores/game'
import type { Owner } from '@/data/owners'
import type { GameOrder } from './gameOrders'
import { resolveLocationId, distanceBetween } from './locationResolver'
import { isInTruce } from './diplomacy'
import { computeActionCost, marchCost } from './economy'

export interface ExecutionContext {
  /** Supplied by trusted application code, never copied from LLM JSON. */
  authority?: 'player' | 'faction' | 'system' | 'debug'
  actor?: Owner
}

const SYSTEM_ORDERS = new Set(['capture', 'setCurrentDate', 'setFactionAlive', 'setCurrentFaction'])
const PAID_ORDERS = new Set(['battle', 'deploy', 'moveTroops', 'recruit', 'develop', 'fortify', 'rally'])

export function checkLiveOrder(order: GameOrder, context: ExecutionContext = {}) {
  const store = useGameStore()
  const reject = (reason: string) => ({ ok: false as const, reason, actor: null, points: 0 })
  if (context.authority === 'debug' || context.authority === 'system') {
    return { ok: true as const, actor: null, points: 0 }
  }
  if (SYSTEM_ORDERS.has(order.order)) return reject('该指令由系统结算管理，不能直接下达')
  const actor = context.actor ?? store.currentFaction
  if (!actor) return reject('尚未选择势力，无法下指令')
  if (store.gameOver?.ended) return reject('本局已结束')
  const fromId = order.from ? resolveLocationId(order.from) : null
  const toId = order.to ? resolveLocationId(order.to) : null
  const gb = order.gb ? resolveLocationId(order.gb) : null
  if (order.from && (!fromId || !store.cities[fromId])) return reject('出发城市不存在')
  if (order.to && (!toId || !store.cities[toId])) return reject('目标城市不存在')
  if (order.gb && (!gb || !store.cities[gb])) return reject('目标城市不存在')
  if (fromId && store.cities[fromId]?.owner !== actor) return reject('只能指挥己方城市')
  if (gb && store.cities[gb]?.owner !== actor) return reject('只能操作己方城市')
  if (order.order === 'moveTroops' && (!toId || store.cities[toId]?.owner !== actor)) return reject('调兵目标必须是己方城市')
  if (order.order === 'stopBattle') {
    const b = store.battles.find(b => b.id === order.id && b.active)
    if (!b || b.attacker !== actor) return reject('只能撤回本方发起的战斗')
    if (order.reason && order.reason !== 'retreat') return reject('停战须通过外交协商，不能直接终止敌方战斗')
  }
  if (order.order === 'battle') {
    if (!fromId || !toId) return reject('开战必须指定出发与目标城市')
    const defender = store.cities[toId]!.owner
    if (defender === actor) return reject('不能对己方城市开战')
    if (isInTruce(store.relations, actor, defender, store.currentDate)) return reject('双方尚在停战期，不能开战')
    if (store.battles.some(b => b.active && b.from === fromId)) return reject('同一来源城只能维持一条战线')
    if (order.deployAmount !== undefined && (!Number.isFinite(order.deployAmount) || order.deployAmount <= 0)) return reject('出兵量必须是有限正数')
    const from = store.cities[fromId]!
    const deploy = order.deployAmount ?? (from.fieldForce > 0 ? 0 : from.troops)
    if (deploy > from.troops) return reject('出兵量超过驻军')
    const troops = deploy || from.fieldForce
    if (troops <= 0) return reject('无可战之兵')
    const distance = distanceBetween(fromId, toId)
    if (distance === null) return reject('无法确定行军距离，不能开战')
    const cost = marchCost(distance, troops)
    if (store.getTreasury(actor) < cost.silver || store.getGranary(actor) < cost.food) return reject('远征银粮不足')
  }
  if (['deploy', 'moveTroops', 'recruit', 'develop', 'fortify', 'rally'].includes(order.order)) {
    if (!Number.isFinite(order.amount) || (order.order === 'rally' ? order.amount! === 0 : order.amount! <= 0)) return reject('行动数量必须是有限有效数值')
    if (['recruit', 'develop', 'fortify', 'rally'].includes(order.order) && Math.abs(order.amount!) > 100) return reject('单次内政增量不能超过100')
    if (['deploy', 'moveTroops'].includes(order.order) && (!fromId || order.amount! > store.cities[fromId]!.troops)) return reject('调出兵力超过驻军')
    if (order.order === 'moveTroops') {
      const distance = fromId && toId ? distanceBetween(fromId, toId) : null
      if (distance === null) return reject('无法确定行军距离，不能调兵')
      const cost = marchCost(distance, order.amount!)
      if (store.getTreasury(actor) < cost.silver || store.getGranary(actor) < cost.food) return reject('行军银粮不足')
    } else if (['recruit', 'develop', 'fortify', 'rally'].includes(order.order)) {
      if (!gb) return reject('内政必须指定己方城市')
      const cost = computeActionCost(order.order as 'recruit' | 'develop' | 'fortify' | 'rally', order.amount!)
      if (store.getTreasury(actor) < cost.silver || store.getGranary(actor) < cost.food) return reject('内政银粮不足')
    }
  }
  // Retreat stays available at zero points. Automatic battle settlement is not an order.
  const points = PAID_ORDERS.has(order.order) ? 1 : 0
  if (points) {
    const check = store.checkAction(actor, points)
    if (!check.ok) return reject(check.reason!)
  }
  return { ok: true as const, actor, points }
}
