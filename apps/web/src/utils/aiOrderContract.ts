/**
 * AI 指令契约 —— 调试工具与真实 agent 共用的唯一真相源。
 *
 * 这里只定义「AI 应该返回什么形状」+「如何严格校验它」，不包含任何执行逻辑。
 * 执行统一走 gameOrders.executeOrder（见 ../utils/gameOrders）。
 *
 * 设计要点：
 * - 调试 AI 是 god-mode（最高权限），可对任意势力下发任意指令。
 * - 校验只做「结构合法性」（城市码存在 / 枚举合法 / 日期格式对），
 *   不做「战略合法性」（如某势力能不能占某城）——战略合法性由生产环境的世界 AI 把关，
 *   调试沙盒故意放开，方便压测。
 */

import type { GameOrder } from './gameOrders'
import { Owner } from '@/data/owners'
import { resolveLocation } from './locationResolver'

/** 全部合法指令（与 gameOrders.OrderType 对齐，单点定义避免漂移）。 */
export const ORDER_TYPES = [
  'attack',
  'scout',
  'declareWar',
  'battle',
  'stopBattle',
  'stopBattles',
  'listBattles',
  'cloud',
  'capture',
  'setFactionAlive',
  'setCurrentDate',
  'setCurrentFaction',
] as const

export type KnownOrder = (typeof ORDER_TYPES)[number]

export type ValidationResult =
  | { ok: true; order: GameOrder }
  | { ok: false; errors: string[] }

const OWNER_VALUES = Object.values(Owner) as Owner[]
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 严格结构校验单条指令。
 * 返回 ok:true + 类型化 order，或 ok:false + 可读错误列表（含可用值提示）。
 */
export function validateGameOrder(json: unknown): ValidationResult {
  const errors: string[] = []

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['输入不是 JSON 对象（批量请使用数组）'] }
  }

  const o = json as Record<string, unknown>
  const order = o.order

  if (typeof order !== 'string' || !(ORDER_TYPES as readonly string[]).includes(order)) {
    return {
      ok: false,
      errors: [`未知指令 order: ${String(order)}（可选：${ORDER_TYPES.join(' / ')}）`],
    }
  }

  const needsFromTo: KnownOrder[] = ['attack', 'declareWar', 'battle']
  if (needsFromTo.includes(order as KnownOrder) && !resolveLocation(String(o.from ?? ''))) {
    errors.push(`from 城市码无效或不存在: ${String(o.from)}`)
  }
  if (needsFromTo.includes(order as KnownOrder) && !resolveLocation(String(o.to ?? ''))) {
    errors.push(`to 城市码无效或不存在: ${String(o.to)}`)
  }

  if (order === 'capture') {
    if (!resolveLocation(String(o.gb ?? ''))) {
      errors.push(`gb 城市码无效或不存在: ${String(o.gb)}`)
    }
    if (!OWNER_VALUES.includes(o.owner as Owner)) {
      errors.push(`owner 非法: ${String(o.owner)}（可选：${OWNER_VALUES.join(' / ')}）`)
    }
    if (o.resultTroops !== undefined && typeof o.resultTroops !== 'number') {
      errors.push('resultTroops 必须是数字（单位 k）')
    }
  }

  if (order === 'setFactionAlive' || order === 'setCurrentFaction') {
    if (!OWNER_VALUES.includes(o.faction as Owner)) {
      errors.push(`faction 非法: ${String(o.faction)}（可选：${OWNER_VALUES.join(' / ')}）`)
    }
  }

  if (order === 'setFactionAlive' && typeof o.alive !== 'boolean') {
    errors.push('alive 必须是布尔值（true/false）')
  }

  if (order === 'setCurrentDate') {
    if (typeof o.date !== 'string' || !ISO_DATE.test(o.date)) {
      errors.push(`date 格式非法: ${String(o.date)}（需 ISO 如 1931-10-01）`)
    }
  }

  if (order === 'stopBattle' && typeof o.id !== 'string') {
    errors.push('stopBattle 需要 id 字段（战斗 id）')
  }

  return errors.length ? { ok: false, errors } : { ok: true, order: json as GameOrder }
}

export interface BatchValidation {
  orders: GameOrder[]
  errors: string[][] // 与 orders 等长；ok 的项对应空数组
  allOk: boolean
}

/** 支持单对象或 GameOrder[] 批量；返回通过校验的指令列表 + 逐项错误。 */
export function validateOrders(input: unknown): BatchValidation {
  const list = Array.isArray(input) ? input : [input]
  const orders: GameOrder[] = []
  const errors: string[][] = []
  let allOk = true

  for (const item of list) {
    const r = validateGameOrder(item)
    if (r.ok) {
      orders.push(r.order)
      errors.push([])
    } else {
      allOk = false
      orders.push(item as GameOrder) // 保留原文便于回显
      errors.push(r.errors)
    }
  }

  return { orders, errors, allOk }
}

/**
 * 给 AI 的契约文案（god-mode 口吻）。
 * 调试工具的 system prompt 与未来真实 agent 共用同一份，保证「AI 看到的」与「前端校验的」一致。
 */
export const CONTRACT_SCHEMA_TEXT = `你是民国军阀推演游戏的最高权限调试 AI（game master），拥有越过一切战略与外交限制、对任意势力直接下发指令的权限。

你必须只返回一个 JSON 对象，或一个 JSON 对象数组（批量指令，按顺序执行）。不要输出多余解释文字。

字段说明：
- order（必填）：指令类型，可选值：
  attack / scout / declareWar / battle / stopBattle / stopBattles / listBattles / cloud
  capture / setFactionAlive / setCurrentDate / setCurrentFaction
- from / to：城市 gb 编码（如 "156500000"），attack / declareWar / battle 必填
- id：战斗 id，stopBattle 必填
- text：演出弹字（可选）
- gb：目标城市 gb 编码，capture 必填
- owner：占领方势力枚举（KMT / CCP / JPN / NEA / SHX / GXC / SCC / MA / XJ / TIB / NEUTRAL），capture 必填
- faction：目标势力枚举（同上），setFactionAlive / setCurrentFaction 必填
- alive：布尔，setFactionAlive 必填（true=存活，false=灭亡）
- date：ISO 日期字符串，setCurrentDate 必填（如 "1931-10-01"）
- resultTroops：数字（单位 k），capture 可选（占领后新驻军）

示例（单条）：
{"order":"capture","gb":"156450200","owner":"KMT","resultTroops":20}

示例（批量）：
[{"order":"setCurrentDate","date":"1937-07-07"},{"order":"setFactionAlive","faction":"JPN","alive":true}]`
