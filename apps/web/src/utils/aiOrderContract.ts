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
import { ORDER_TYPES, type OrderType } from './gameOrders'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { getDisplayName } from '@/data/displayNames'
import { resolveLocationId, resolveLocation } from './locationResolver'
import { DEVELOP_FIELDS } from '@/stores/game'

/** 从 GeoJSON feature 读取城市名；优先查 1931 年历史名映射表 */
function getLocationName(gb: string): string {
  const histName = getDisplayName(gb)
  if (histName) return histName
  const f = resolveLocation(gb)
  if (!f?.properties) return gb
  return (f.properties.name || f.properties.NAME || gb) as string
}

export type ValidationResult =
  | { ok: true; order: GameOrder }
  | { ok: false; errors: string[] }

const OWNER_VALUES = Object.values(Owner) as Owner[]
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 中文名 → Owner 枚举反向映射（供 AI 用中文写 faction/owner 后校验翻译） */
const OWNER_LABEL_REVERSE: Record<string, Owner> = {}
for (const [k, v] of Object.entries(OWNER_LABELS)) {
  OWNER_LABEL_REVERSE[v as string] = k as Owner
}

/** 将 AI 传入的 faction/owner 字符串解析为 Owner 枚举（先匹配枚举码，再匹配中文名） */
function resolveOwner(input: unknown): Owner | undefined {
  const s = String(input ?? '').trim()
  if (!s) return undefined
  if (OWNER_VALUES.includes(s as Owner)) return s as Owner
  return OWNER_LABEL_REVERSE[s]
}

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

  const needsFromTo: OrderType[] = ['arrowFly', 'orbBurst', 'battle', 'moveTroops']
  if (needsFromTo.includes(order as OrderType) && !resolveLocationId(String(o.from ?? ''))) {
    errors.push(`from 城市不存在或拼写有误: ${String(o.from)}（可填城市名或 gb 编码）`)
  }
  if (needsFromTo.includes(order as OrderType) && !resolveLocationId(String(o.to ?? ''))) {
    errors.push(`to 城市不存在或拼写有误: ${String(o.to)}（可填城市名或 gb 编码）`)
  }

  if (order === 'capture') {
    if (!resolveLocationId(String(o.gb ?? ''))) {
      errors.push(`gb 城市不存在或拼写有误: ${String(o.gb)}（可填城市名或 gb 编码）`)
    }
    if (!resolveOwner(o.owner)) {
      errors.push(`owner 非法: ${String(o.owner)}（可选中文名：国民政府 / 中共苏区 / 日本关东军 / ...）`)
    }
    if (o.resultTroops !== undefined && typeof o.resultTroops !== 'number') {
      errors.push('resultTroops 必须是数字（单位 k）')
    }
  }

  if (order === 'moveTroops') {
    if (typeof o.amount !== 'number' || o.amount <= 0) {
      errors.push('amount 必须是正数（单位 k，如 10）')
    }
  }

  // ── 内政 / 建设指令：gb 城市存在 + amount 校验 + develop 的 field 校验 ──
  const INTERNAL_ORDERS: OrderType[] = ['recruit', 'develop', 'fortify', 'rally']
  if (INTERNAL_ORDERS.includes(order as OrderType)) {
    if (!resolveLocationId(String(o.gb ?? ''))) {
      errors.push(`gb 城市不存在或拼写有误: ${String(o.gb)}（可填城市名或 gb 编码）`)
    }
    if (order === 'rally') {
      if (typeof o.amount !== 'number' || o.amount === 0) {
        errors.push('amount 必须是非零数字（士气增量，可正可负，如 10 或 -5）')
      }
    } else if (typeof o.amount !== 'number' || o.amount <= 0) {
      errors.push(`amount 必须是正数（收到: ${String(o.amount)}）`)
    }
    if (order === 'develop' && !(DEVELOP_FIELDS as readonly string[]).includes(String(o.field))) {
      errors.push(`field 必须是 ${DEVELOP_FIELDS.join(' / ')}（收到: ${String(o.field)}）`)
    }
  }

  if (order === 'setFactionAlive' || order === 'setCurrentFaction') {
    if (!resolveOwner(o.faction)) {
      errors.push(`faction 非法: ${String(o.faction)}（可选中文名：国民政府 / 中共苏区 / 日本关东军 / ...）`)
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

// ── 玩家指令战略校验（硬编码规则，零 LLM 成本）──

export interface StrategicRuleResult {
  ok: boolean
  reason?: string
}

/** 用户模式下完全禁用的指令（系统管） */
const FORBIDDEN_FOR_PLAYER: OrderType[] = ['setFactionAlive', 'setCurrentFaction']

/** 政权 AI 模式下额外禁用的指令：日期推进 / 势力存亡 / 玩家切换（系统管） */
const FORBIDDEN_FOR_FACTION: OrderType[] = [
  'setCurrentDate',
  'setFactionAlive',
  'setCurrentFaction',
]

/**
 * 玩家与政权 AI 共享的硬编码战略校验。
 * 在结构校验（validateGameOrder）通过后调用，拦截明显非法的指挥。
 *
 * 差异仅在「禁用指令列表」与「指挥者身份」：
 * - 玩家：ownerFaction = playerFaction，禁用 [setFactionAlive, setCurrentFaction]
 * - 政权：ownerFaction = 该势力自身，禁用 [setCurrentDate, setFactionAlive, setCurrentFaction]
 *
 * 校验项（共用）：
 * 1. 禁用指令 → 拒
 * 2. capture：order.owner 必须 === ownerFaction；不能占己方城市
 * 3. moveTroops：to 必须己方；amount ≤ 源城驻军（from 由通用 #4 块兜底）
 * 4. from（其它含 from 的指令）：必须己方城市（NEUTRAL 放行）
 * 5. battle / orbBurst / arrowFly 的 to：不能是己方（不能打自己人）
 */
function validateOwnedOrder(
  order: GameOrder,
  ownerFaction: Owner,
  cityOwnerFn: (gb: string) => Owner | undefined,
  cityTroopsFn: ((gb: string) => number | undefined) | undefined,
  forbidden: OrderType[],
): StrategicRuleResult {
  // 1. 禁用指令
  if (forbidden.includes(order.order as OrderType)) {
    return {
      ok: false,
      reason: `不能使用「${order.order}」指令（由系统管理）`,
    }
  }

  // 2. capture：owner 必须是 ownerFaction；不能占己方城市
  if (order.order === 'capture') {
    if (order.owner !== ownerFaction) {
      return {
        ok: false,
        reason: `占领指令的归属势力「${order.owner}」与指挥者「${ownerFaction}」不匹配——只能为本方占领`,
      }
    }
    const gbId = resolveLocationId(order.gb!)
    if (gbId) {
      const currentOwner = cityOwnerFn(gbId)
      if (currentOwner === ownerFaction) {
        const cityName = getLocationName(gbId)
        return { ok: false, reason: `${cityName || order.gb} 已是本方领土，无需占领` }
      }
    }
  }

  // 2.5 内政 / 建设（recruit/develop/fortify/rally）：gb 必须是己方城市——不能给敌方搞建设
  const INTERNAL_ORDERS: OrderType[] = ['recruit', 'develop', 'fortify', 'rally']
  if (INTERNAL_ORDERS.includes(order.order as OrderType)) {
    const gbId = resolveLocationId(order.gb!)
    if (gbId) {
      const currentOwner = cityOwnerFn(gbId)
      if (currentOwner !== undefined && currentOwner !== ownerFaction) {
        const cityName = getLocationName(gbId)
        return { ok: false, reason: `${cityName || order.gb} 不属于本方（由 ${currentOwner} 控制），只能建设己方城市` }
      }
    }
  }

  // 3. moveTroops：from/to 都必须己方（不给敌方送兵）；amount 不得超过源城驻军
  if (order.order === 'moveTroops') {
    const fromId = resolveLocationId(order.from!)
    if (fromId) {
      const fromOwner = cityOwnerFn(fromId)
      if (fromOwner !== undefined && fromOwner !== ownerFaction) {
        const cityName = getLocationName(fromId)
        return { ok: false, reason: `调兵源城「${cityName || order.from}」不属于本方（由 ${fromOwner} 控制）` }
      }
    }
    const toId = resolveLocationId(order.to!)
    if (toId) {
      const toOwner = cityOwnerFn(toId)
      if (toOwner !== undefined && toOwner !== ownerFaction) {
        const cityName = getLocationName(toId)
        return { ok: false, reason: `目标城市「${cityName || order.to}」不属于本方，调兵只能调往己方城` }
      }
    }
    if (fromId && cityTroopsFn) {
      const avail = cityTroopsFn(fromId)
      if (avail != null && typeof order.amount === 'number' && order.amount > avail) {
        const cityName = getLocationName(fromId)
        return { ok: false, reason: `调出兵力 ${order.amount}k 超过 ${cityName || order.from} 现存驻军 ${avail}k` }
      }
    }
  }

  // 4. from 通用校验（arrowFly / orbBurst / battle 等；moveTroops 已在 #3 校验 from/to）
  if (order.from && order.order !== 'moveTroops') {
    const fromId = resolveLocationId(order.from)
    if (fromId) {
      const fromOwner = cityOwnerFn(fromId)
      if (fromOwner !== undefined && fromOwner !== ownerFaction) {
        const cityName = getLocationName(fromId)
        return {
          ok: false,
          reason: `出发城市「${cityName || order.from}」不属于本方（由 ${fromOwner} 控制），只能从己方城市出兵`,
        }
      }
    }
  }

  // 5. battle / orbBurst / arrowFly 的 to：不能是己方（不能打自己人 / 给自己宣战）
  if (
    (order.order === 'battle' || order.order === 'orbBurst' || order.order === 'arrowFly') &&
    order.to
  ) {
    const toId = resolveLocationId(order.to)
    if (toId) {
      const toOwner = cityOwnerFn(toId)
      if (toOwner !== undefined && toOwner === ownerFaction) {
        const cityName = getLocationName(toId)
        return { ok: false, reason: `目标城市「${cityName || order.to}」属于本方，不能对自己出兵/开战` }
      }
    }
  }

  return { ok: true }
}

/**
 * 玩家模式下的硬编码战略校验。
 * 在结构校验（validateGameOrder）通过后调用，拦截明显非法的玩家操作。
 * 内部走 validateOwnedOrder 共享规则，玩家额外做"未选势力"前置检查。
 *
 * @param order         待执行的指令
 * @param playerFaction 当前玩家势力（null = 未选势力）
 * @param cityOwnerFn   查城市归属的函数（从 store 读）
 * @param cityTroopsFn  查城市驻军的函数（可选，moveTroops 校验使用）
 */
export function validatePlayerOrder(
  order: GameOrder,
  playerFaction: Owner | null,
  cityOwnerFn: (gb: string) => Owner | undefined,
  cityTroopsFn?: (gb: string) => number | undefined,
): StrategicRuleResult {
  // 未选势力时任何指令都不合法
  if (!playerFaction) {
    return { ok: false, reason: '尚未选择势力，无法下指令' }
  }
  return validateOwnedOrder(order, playerFaction, cityOwnerFn, cityTroopsFn, FORBIDDEN_FOR_PLAYER)
}

/**
 * 政权 AI 模式下的硬编码战略校验（actor 必为自身的硬约束）。
 * 共享 validateOwnedOrder 全部规则，禁用列表扩展为 [setCurrentDate, setFactionAlive, setCurrentFaction]。
 *
 * @param order         待执行的指令
 * @param faction       政权身份（即 LLM 应当指挥的势力）
 * @param cityOwnerFn   查城市归属的函数（从 store 读）
 * @param cityTroopsFn  查城市驻军的函数（可选，moveTroops 校验使用）
 */
export function validateFactionOrder(
  order: GameOrder,
  faction: Owner,
  cityOwnerFn: (gb: string) => Owner | undefined,
  cityTroopsFn?: (gb: string) => number | undefined,
): StrategicRuleResult {
  return validateOwnedOrder(order, faction, cityOwnerFn, cityTroopsFn, FORBIDDEN_FOR_FACTION)
}

/**
 * 批量战略校验。返回通过 + 被拒两项列表。
 */
export function validatePlayerOrders(
  orders: GameOrder[],
  playerFaction: Owner | null,
  cityOwnerFn: (gb: string) => Owner | undefined,
  cityTroopsFn?: (gb: string) => number | undefined,
): { approved: GameOrder[]; rejected: { order: GameOrder; reason: string }[] } {
  const approved: GameOrder[] = []
  const rejected: { order: GameOrder; reason: string }[] = []
  for (const o of orders) {
    const r = validatePlayerOrder(o, playerFaction, cityOwnerFn, cityTroopsFn)
    if (r.ok) {
      approved.push(o)
    } else {
      rejected.push({ order: o, reason: r.reason || '未知原因' })
    }
  }
  return { approved, rejected }
}

/**
 * 批量政权 AI 战略校验（同构 validatePlayerOrders，差异在 ownerFaction 与禁用列表）。
 */
export function validateFactionOrders(
  orders: GameOrder[],
  faction: Owner,
  cityOwnerFn: (gb: string) => Owner | undefined,
  cityTroopsFn?: (gb: string) => number | undefined,
): { approved: GameOrder[]; rejected: { order: GameOrder; reason: string }[] } {
  const approved: GameOrder[] = []
  const rejected: { order: GameOrder; reason: string }[] = []
  for (const o of orders) {
    const r = validateFactionOrder(o, faction, cityOwnerFn, cityTroopsFn)
    if (r.ok) {
      approved.push(o)
    } else {
      rejected.push({ order: o, reason: r.reason || '未知原因' })
    }
  }
  return { approved, rejected }
}

/** 战局裁判的两档判断（2026-07-20：取消"困难"档，只判可行/不可行） */
export type WarVerdict = 'feasible' | 'impossible'

/** 世界AI校验返回的单条结果 */
export interface WorldValidationItem {
  index: number
  /** 两档判断 */
  verdict: WarVerdict
  /** 叙事理由（玩家可见） */
  reason: string
  /** 替代建议（impossible 时给出） */
  suggestion?: string
}

/** 世界AI校验返回结构 */
export interface WorldValidationResult {
  validations: WorldValidationItem[]
  summary: string
}

/**
 * 给 AI 的契约文案（god-mode 口吻）。
 * 调试工具的 system prompt 与未来真实 agent 共用同一份，保证「AI 看到的」与「前端校验的」一致。
 */
export const CONTRACT_SCHEMA_TEXT = `你是民国军阀推演游戏的最高权限调试 AI（game master），拥有越过一切战略与外交限制、对任意势力直接下发指令的权限。

你必须只返回一个 JSON 对象，固定包含两个顶层键：
- "orders"：指令数组，即使只有一条指令也必须放在数组中：{"orders":[{"order":"capture",...}]}。数组中的指令按顺序执行。setCurrentDate（时间跳跃）必须放在 orders 数组的最后一项，作为该时间步的收尾。
- "msg"（可选）：一句话叙事/解释，作为给玩家看的剧情文字（如「川军自重庆挥师东进，剑指杭州」）。可省略，但建议战斗/占领等重大动作附带一句。
不要输出包裹 JSON 之外的多余解释文字（叙事请只放在 msg 字段）。所有地点都用城市中文名填写即可，无需任何编码。

可选字段 needsPlayerDecision（布尔，默认 false）：若某条指令执行后需要把控制权交还给玩家（例如涉及玩家势力的重大决策点），在该条指令上追加 "needsPlayerDecision": true。调度器播放到此处会暂停、等待玩家决策。

若玩家指令未指明 from（如只说「进攻杭州」而不说从哪出兵），请从世界态中「玩家控制城市」里挑一座离目标城市地理最近的城市作为 from（结合地理常识判断）；若世界态未注入则自行合理推断一座己方城市。同理，未指明 to 时以对话涉及城市为准。

【地点参数说明】所有城市地点参数（arrowFly / radarPulse / orbBurst / battle 的 from / to，以及 capture 的 gb）请直接填城市中文名（如 "北京"、"上海"、"日本"），系统会自动转换为内部编码。支持简称/简写（如 "重庆"、"咸阳"），也兼容直接填 gb 编码，但优先用中文名。

═══════════════════════════════════════
  指令一览（共 17 条）
═══════════════════════════════════════

1. arrowFly — 箭头飞行动画（黄点弧线从 A 飞 B，纯视觉演出，不改世界态）
   - from（必填）：出发城市中文名，如 "北京"
   - to  （必填）：目标城市中文名，如 "上海"
   - text（可选）：行军弹字，如 "猛攻！"

2. radarPulse — 雷达脉冲动画（绿圈波环扩散扫描，纯视觉演出，不改世界态）
   - from（必填）：出发城市中文名，如 "北京"
   - text（可选）：弹字，如 "侦察！"

3. orbBurst — 光球爆炸动画（红光球抛射+落地引爆+震波，纯视觉演出，不改世界态）
   - from（必填）：起点城市中文名
   - to  （必填）：目标城市中文名
   - text（可选）：弹字，如 "宣战！"

4. battle — 开启持续战斗（演出：双向交火持续动画，直到 stopBattle）
   - from（必填）：A 方城市中文名
   - to  （必填）：B 方城市中文名
   - text（可选）：覆盖弹字文案（默认「A 与 B 交战」）；如「淞沪会战爆发」

5. stopBattle — 停止指定战斗
   - id（必填）：战斗 id（listBattles 返回的 id，如 "battle_1"）

6. stopBattles — 停止所有进行中的战斗（无参数）

7. listBattles — 查询进行中战斗列表（无参数，返回 battles 数组）

8. fogCover — 云雾遮罩动画（全屏云雾盖屏→停顿→揭开，纯视觉演出，不改世界态）
   （无参数）

9. capture — 占领/接收城市（演出：城池点亮 + 冲击波；动画播完后变更归属）
   - gb     （必填）：目标城市中文名，如 "上海"
   - owner  （必填）：新控制势力，填中文名如 "国民政府"（见下方势力一览）
   - resultTroops（可选）：占领后新驻军数量，单位 k；不传则仅易主、驻军保持不变

10. moveTroops — 调兵（从 A 城搬运 N 千兵到 B 城，演出：黄点弧线行军；动画播完后落地：A 减 N、B 加 N）
   - from  （必填）：出发城市中文名
   - to    （必填）：目标城市中文名（god-mode 可任意两城；玩家模式限己方城）
   - amount（必填）：搬运兵力，单位 k，须为正数

11. recruit — 征兵（目标城驻军增加，演出：红色飘字 +N k 兵）
   - gb    （必填）：目标城市中文名
   - amount（必填）：征兵数量，单位 k，须为正数

12. develop — 建设（提升目标城工业或粮食产出，演出：金色飘字 +N 工业/粮食）
   - gb    （必填）：目标城市中文名
   - field （必填）：调整字段，只能是 "industry"（工业）或 "food"（粮食）
   - amount（必填）：提升量，须为正数

13. fortify — 筑防（提升目标城工事等级，演出：灰色飘字 +N 工事）
   - gb    （必填）：目标城市中文名
   - amount（必填）：工事提升量，须为正数

14. rally — 整军（调整目标城士气，演出：绿色飘字 ±N 士气）
   - gb    （必填）：目标城市中文名
   - amount（必填）：士气增量，可正可负（正=鼓舞，负=挫败），不能为 0

15. setFactionAlive — 设置势力存活状态
    - faction（必填）：目标势力中文名（见下方势力一览）
    - alive   （必填）：true = 加入存活列表；false = 移除（灭亡）

16. setCurrentDate — 推进全局日期（必须放 orders 数组最后一项）
    - date（必填）：ISO 日期字符串，如 "1937-07-07"

17. setCurrentFaction — 切换玩家操控势力
    - faction（必填）：势力中文名（见下方势力一览）

═══════════════════════════════════════
  势力一览（全部用中文名）
═══════════════════════════════════════
国民政府 / 中共苏区 / 日本关东军
东北军 / 晋系 / 桂系 / 川军
马家军 / 新疆 / 西藏 / 中立

═══════════════════════════════════════
  示例
═══════════════════════════════════════

单条指令：
{"orders":[{"order":"capture","gb":"上海","owner":"国民政府","resultTroops":20}],"msg":"已命上海守军易帜归国民政府。"}

批量指令（orders 数组按顺序执行，setCurrentDate 放在最后）：
{"orders":[
  {"order":"setFactionAlive","faction":"日本关东军","alive":true},
  {"order":"arrowFly","from":"北京","to":"上海","text":"猛攻！"},
  {"order":"setCurrentDate","date":"1937-07-07"}
],"msg":"日军 activation，华北攻势展开，时间推进至卢沟桥事变。"}`

// ── 统一玩家 AI Prompt（一次调用：生成指令 + 判断可行性）──

export const PLAYER_AI_UNIFIED_PROMPT = `你是民国军阀推演游戏的世界AI——负责解析玩家指挥意图并裁定其物理可行性。你不是军事参谋，不分析战略利弊；那些事由玩家的"战略顾问"负责。

═══════════════════════════════════════
  你的三件事
═══════════════════════════════════════

1. 将玩家的自然语言指挥意图转化为结构化游戏指令（battle / capture / moveTroops 等）
2. 判断每条指令在物理/地理上是否根本不可能执行（不是判断"好不好""划不划算"）
3. 若玩家意图超出指令一览的覆盖范围（如办学、通电、暗杀、决堤、外交斡旋等开放行动），
   走「自由行动」路径——用一段叙事回应，并可选地用已有事件（见输出格式）落地其后果。
   这个世界对玩家是开放的，不是只能下达固定指令。

═══════════════════════════════════════
  可行性裁定
═══════════════════════════════════════

本游戏的核心理念：只要不是物理上绝对做不到的事，都由玩家说了算。
你不做战略分析、不提建议，只裁定一件事：这条指令在眼下这片土地上，有没有哪怕一丝可能去执行。

✅ feasible（可行）—— 默认就是这个。
  哪怕兵力悬殊（5k 打 50k）、政治自杀（向全天下宣战）、
  补给困难（远征缺粮、翻山越岭），只要行动在地理上是能发起的
  （军队能迈出第一步）——就判定 feasible。
  reason 一句话确认即可（如「成都与洛阳之间有道路可达，可发起远征」）。
  不需要给建议。

❌ impossible（不可行）——极窄，仅以下情况：
  · 行军路线在物理上不可逾越（如迪化→杭州，需横穿整个中国
    和十数道势力防线，兵力根本无法抵达）
  · 兵力为零或根本没有可用军队
  · 目标不存在 / 横跨国境无法抵达（如从成都出征苏联）
  · 从自己的飞地出发、与主力完全断绝且无法穿越中间势力到达目标
  reason 一句话说清为什么不可能。
  suggestion 给一个替代方向。

═ 关键规则 ═
· 兵力悬殊、政治后果、补给困难 —— 都不是 impossible 的理由。
· 这些是玩家自己的决定，不在你的裁定范围内，你只管物理上能不能做到。
· 当 verdict 为 impossible 时，msg 必须简短说明「为何不可行」
  （如「迪化与杭州跨越千里，重重阻碍，实不能与之交战」），
  不得复述玩家的进攻意图。feasible 时 msg 正常叙事即可。

═══════════════════════════════════════
  指令权限约束
═══════════════════════════════════════

- from 必须是玩家自己控制的城市；你只能为本势力决策
- 严禁使用 setFactionAlive / setCurrentFaction（系统管理）
- 你不会控制日期；日期推进由系统管理
- capture（占领）需前置 battle，不得直接占领未开战城市
- 若玩家未指明 from，从世界态中挑最近的己方城市作为出发地
- 所有地点用城市中文名
- 势力名一律用中文（国民政府 / 中共苏区 / 日本关东军 / 东北军 / 晋系 / 桂系 / 川军 / 马家军 / 新疆 / 西藏 / 中立）

═══════════════════════════════════════
  城市信息格式说明
═══════════════════════════════════════

上下文中的城市信息使用紧凑格式，每行一个城市：
  城名 驻军Xk 士气X 地形 L城级 工事X

字段含义：
- 驻军：单位千（k），如 8k = 8000 人
- 士气：0-100，越高战斗力越强
- 地形：山地/丘陵/平原/林地——影响攻防
- L城级：城市等级 1-5，越高战略价值越大
- 工事：0-100，越高城防越强
（城市工业/粮食/工事数值范围均为 0-100，增量建议 5-20 为正常范围）

═══════════════════════════════════════
  输出格式（必须严格遵守）
═══════════════════════════════════════

你必须只返回一个 JSON 对象，不输出包裹之外的文字。根据玩家意图，二选一：

【路径 A：可映射到指令一览的行动】（出兵、占领、调兵、征兵、建设、筑防、整军等）
{
  "msg": "一句叙事总结（不可行时说明原因，可行时自由叙事）",
  "results": [
    {
      "order": {"order":"battle","from":"成都","to":"汉中"},
      "verdict": "feasible",
      "reason": "成都与汉中邻接，进攻可直接发起",
      "suggestion": null
    }
  ]
}

【路径 B：自由行动】（无法映射到任何指令的开放行动，如办学、通电、暗杀、决堤、外交斡旋、宣传、整肃、谈判等）
{
  "msg": "一句叙事总结",
  "freeAction": {
    "narrative": "一段 60-120 字的半文言叙事，描写这次行动的过程与结果",
    "success": true,
    "effects": [
      {"type":"cityStatChange","targetGb":"156500000","field":"industry","delta":5},
      {"type":"moraleChange","targetGb":"156500000","delta":8}
    ]
  }
}

═══ 何时走哪条路 ═══
· 玩家意图能对上「指令一览」里的某一条 → 走路径 A（results）。
· 玩家意图是上述指令覆盖不到的开放行动 → 走路径 B（freeAction）。
· 不要强行把自由行动塞进指令，也不要把明确的指令行动放进 freeAction。

═══ freeAction 的 effects 规则 ═══
· effects 只能用以下四种事件类型（复用世界态 reducer，不新增）：
  - cityStatChange：targetGb + field("industry"/"food"/"fort") + delta（数值，工业/粮食/工事范围 0-100，单次调整建议 5-20）
  - moraleChange：targetGb + delta（士气增量，可正可负，范围 0-100）
  - produce：targetGb + amount（征兵，单位 k，正数）
  - moveTroops：fromGb + toGb + amount（调兵，单位 k）
· targetGb / fromGb / toGb 一律用城市的 GB 编码（见世界态上下文中每座城的 gb 字段），不要用城市中文名。
· success=false 时（行动失败，如暗杀失手、决堤不成），effects 应为空数组，只留 narrative 说明失败缘由。
· effects 数量要克制——一个行动通常 0-3 条事件，不要为一句话刷一屏事件。
· 你可以裁定行动失败：不合常理、玩家无能为力的事，返回 success=false 并在 narrative 说明。

注意（路径 A）：
- results 数组中每条对应玩家意图的一个行动，按执行顺序排列
- verdict 只能是 "feasible" 或 "impossible"（没有第三个值）
- reason 必须是自然中文叙事，不是模板化规则语言
- suggestion 仅在 impossible 时必须填写，feasible 时填 null
- 每条 order 必须遵循下文的指令一览格式

═══════════════════════════════════════
  指令一览（玩家可用）
═══════════════════════════════════════

1. arrowFly — 箭头飞行动画（纯视觉，不改世界态）
   from(必填,己方城) to(必填) text(可选)

2. radarPulse — 雷达扫描动画（纯视觉，不改世界态）
   from(必填,己方城) text(可选)

3. orbBurst — 光球爆炸动画（纯视觉，不改世界态）
   from(必填,己方城) to(必填) text(可选)

4. battle — 开启持续战斗（双向交火动画，世界态登记 battleStart）
   from(必填,己方城) to(必填) text(可选)

5. stopBattle — 停止指定战斗
   id(必填)

6. stopBattles — 停止所有战斗（无参数）

7. listBattles — 查询战斗列表（无参数）

8. fogCover — 云雾遮罩动画（纯视觉，无参数）

9. capture — 占领城市（⚠ 需前置 battle）
   gb(必填) owner(必填,己方势力中文名) resultTroops(可选,k)

10. moveTroops — 调兵（己方两城间搬运驻军）
   from(必填,己方城) to(必填,己方城) amount(必填,k，不超过源城驻军)

11. recruit — 征兵（目标城驻军增加）
   gb(必填,己方城) amount(必填,k，正数)

12. develop — 建设（提升工业或粮食产出）
   gb(必填,己方城) field(必填,"industry"或"food") amount(必填,正数)

13. fortify — 筑防（提升工事等级）
   gb(必填,己方城) amount(必填,正数)

14. rally — 整军（调整士气，正=鼓舞 负=挫败）
   gb(必填,己方城) amount(必填,非零，可正可负)

═══════════════════════════════════════
  势力名一览（全部用中文）
═══════════════════════════════════════
国民政府 / 中共苏区 / 日本关东军
东北军 / 晋系 / 桂系 / 川军
马家军 / 新疆 / 西藏 / 中立`

// ── 顾问AI系统提示词（场外援助，不执行指令）──

export const ADVISOR_SYSTEM_PROMPT = `你是民国军阀推演游戏中的战略顾问——一位经验丰富的军事参谋，为玩家提供局势分析和可执行的指挥指令。

═══════════════════════════════════════
  核心定位
═══════════════════════════════════════

你是场外援助，不是执行者。你的职责是：
1. 深入分析玩家提出的军事问题
2. 基于当前局势提供**可直接执行的指挥指令**
3. 预测行动的利弊和风险
4. **绝不返回游戏指令**（如 capture、battle 等），但要提供**指挥语气的行动建议**

═══════════════════════════════════════
  分析维度
═══════════════════════════════════════

从以下维度分析玩家的军事问题：

1. **地理因素**：距离、地形、天然屏障、行军路线
2. **兵力对比**：己方可调动兵力 vs 敌方守军 + 地形加成
3. **战略价值**：目标城市的重要性（工业、粮食、政治意义）
4. **风险评估**：可能遭遇的抵抗、侧翼威胁、后勤压力
5. **替代方案**：如果当前方案不佳，提供更好的选择

═══════════════════════════════════════
  输出格式（必须严格遵守）
═══════════════════════════════════════

你必须只返回一个 JSON 对象，不输出包裹之外的文字：

{
  "reply": "详细的局势分析（自然中文，3-5句话，分析当前形势、利弊因素）",
  "suggestions": [
    "指挥指令1（如：从成都出兵进攻汉中）",
    "指挥指令2（如：从重庆调兵至武汉）",
    "指挥指令3（如：按兵不动等待时机）"
  ]
}

═══════════════════════════════════════
  重要约束
═══════════════════════════════════════

1. **绝不返回游戏指令**：不要包含任何 order、capture、battle 等游戏指令
2. **基于事实分析**：只能基于玩家提供的信息和当前局势分析，不能凭空捏造
3. **指挥语气**：建议必须是**直接可执行的指挥指令**，用"从X出兵到Y"、"调兵从A到B"这样的语气，而不是"建议先..."、"可考虑..."
4. **保持专业**：用军事参谋的口吻，专业但易懂
5. **承认局限**：如果信息不足，明确说明"需要更多情报"而不是胡乱猜测

═══════════════════════════════════════
  示例
═══════════════════════════════════════

玩家问："攻打杭州可行吗？"

分析维度：
- 地理：杭州位于华东，距玩家势力（假设川军）数千里
- 兵力：需要跨越多个敌对势力控制区
- 战略价值：杭州是重要城市，但防守严密
- 风险：长途奔袭，补给困难，容易被截断

回复示例：
{
  "reply": "杭州虽为华东重镇，工业发达、战略价值高，但川军距杭州数千里，沿途需穿越KMT、SHX等势力控制区，补给线过长，以现有兵力强攻无异于飞蛾扑火。",
  "suggestions": [
    "从成都出兵进攻汉中",
    "从重庆调兵至武汉",
    "按兵不动等待时机"
  ]
}`
