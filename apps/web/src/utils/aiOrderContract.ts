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
import { resolveLocationId } from './locationResolver'

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
  if (needsFromTo.includes(order as KnownOrder) && !resolveLocationId(String(o.from ?? ''))) {
    errors.push(`from 城市不存在或拼写有误: ${String(o.from)}（可填城市名或 gb 编码）`)
  }
  if (needsFromTo.includes(order as KnownOrder) && !resolveLocationId(String(o.to ?? ''))) {
    errors.push(`to 城市不存在或拼写有误: ${String(o.to)}（可填城市名或 gb 编码）`)
  }

  if (order === 'capture') {
    if (!resolveLocationId(String(o.gb ?? ''))) {
      errors.push(`gb 城市不存在或拼写有误: ${String(o.gb)}（可填城市名或 gb 编码）`)
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

你必须只返回一个 JSON 对象，顶层键固定为 data，其值为指令数组：{"data": [ ... ]}。即使只有一条指令，也必须放在 data 数组中：{"data": [{"order":"capture",...}]}。数组中的指令按顺序执行。不要输出多余解释文字。所有地点都用城市中文名填写即可，无需任何编码。

【地点参数说明】所有城市地点参数（attack / scout / declareWar / battle 的 from / to，以及 capture 的 gb）请直接填城市中文名（如 "北京"、"上海"、"日本"），系统会自动转换为内部编码。支持简称/简写（如 "重庆"、"咸阳"），也兼容直接填 gb 编码，但优先用中文名。

═══════════════════════════════════════
  指令一览（共 12 条）
═══════════════════════════════════════

1. attack — 派兵进攻（演出：箭头行军动画）
   - from（必填）：出发城市中文名，如 "北京"
   - to  （必填）：目标城市中文名，如 "上海"
   - text（可选）：行军弹字，如 "猛攻！"

2. scout — 侦察/探察（演出：圆环扩散动画）
   - from（必填）：出发城市中文名，如 "北京"
   - text（可选）：弹字，如 "侦察！"

3. declareWar — 宣战（演出：光球爆炸动画）
   - from（必填）：宣战国城市中文名
   - to  （必填）：目标国城市中文名
   - text（可选）：弹字，如 "宣战！"

4. battle — 开启持续战斗（演出：双向交火持续动画，直到 stopBattle）
   - from（必填）：A 方城市中文名
   - to  （必填）：B 方城市中文名

5. stopBattle — 停止指定战斗
   - id（必填）：战斗 id（listBattles 返回的 id，如 "battle_1"）

6. stopBattles — 停止所有进行中的战斗（无参数）

7. listBattles — 查询进行中战斗列表（无参数，返回 battles 数组）

8. cloud — 云雾蒙太奇（演出：时间流逝过渡，可用于隐藏日期推进等状态切换）
   （无参数）

9. capture — 占领/接收城市（演出：城池点亮 + 冲击波；动画播完后变更归属）
   - gb     （必填）：目标城市中文名，如 "上海"
   - owner  （必填）：新控制势力，填枚举码 KMT / CCP / JPN / NEA / SHX / GXC / SCC / MA / XJ / TIB / NEUTRAL
   - resultTroops（可选）：占领后新驻军数量，单位 k；不传则仅易主、驻军保持不变

10. setFactionAlive — 设置势力存活状态
    - faction（必填）：目标势力枚举码（同上）
    - alive   （必填）：true = 加入存活列表；false = 移除（灭亡）

11. setCurrentDate — 推进全局日期
    - date（必填）：ISO 日期字符串，如 "1937-07-07"

12. setCurrentFaction — 切换玩家操控势力
    - faction（必填）：势力枚举码（同上）

═══════════════════════════════════════
  势力枚举值（faction / owner 请填这些码，勿用中文）
═══════════════════════════════════════
KMT  国民政府    CCP  中共苏区      JPN  日本关东军
NEA  东北军      SHX  晋系          GXC  桂系
SCC  川军        MA   马家军        XJ   新疆
TIB  西藏        NEUTRAL 中立

═══════════════════════════════════════
  示例
═══════════════════════════════════════

单条指令：
{"data":[{"order":"capture","gb":"上海","owner":"KMT","resultTroops":20}]}

批量指令（data 数组按顺序执行）：
{"data":[
  {"order":"setCurrentDate","date":"1937-07-07"},
  {"order":"setFactionAlive","faction":"JPN","alive":true},
  {"order":"attack","from":"北京","to":"上海","text":"猛攻！"}
]}`
