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
import { resolveLocationId, resolveLocation } from './locationResolver'

/** 从 GeoJSON feature 读取城市名；解析失败返回 gb 码 */
function getLocationName(gb: string): string {
  const f = resolveLocation(gb)
  if (!f?.properties) return gb
  return (f.properties.name || f.properties.NAME || gb) as string
}

/** 全部合法指令（与 gameOrders.OrderType 对齐，单点定义避免漂移）。 */
export const ORDER_TYPES = [
  'arrowFly',
  'radarPulse',
  'orbBurst',
  'battle',
  'stopBattle',
  'stopBattles',
  'listBattles',
  'fogCover',
  'capture',
  'setFactionAlive',
  'setCurrentDate',
  'setCurrentFaction',
  'moveTroops',
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

  const needsFromTo: KnownOrder[] = ['arrowFly', 'orbBurst', 'battle', 'moveTroops']
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

  if (order === 'moveTroops') {
    if (typeof o.amount !== 'number' || o.amount <= 0) {
      errors.push('amount 必须是正数（单位 k，如 10）')
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

// ── 玩家指令战略校验（硬编码规则，零 LLM 成本）──

export interface StrategicRuleResult {
  ok: boolean
  reason?: string
}

/** 用户模式下完全禁用的指令（系统管） */
const FORBIDDEN_FOR_PLAYER: KnownOrder[] = ['setFactionAlive', 'setCurrentFaction']

/**
 * 玩家模式下的硬编码战略校验。
 * 在结构校验（validateGameOrder）通过后调用，拦截明显非法的玩家操作。
 *
 * @param order         待执行的指令
 * @param playerFaction 当前玩家势力（null = 未选势力）
 * @param cityOwnerFn   查城市归属的函数（从 store 读）
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

  // 禁止指令
  if (FORBIDDEN_FOR_PLAYER.includes(order.order as KnownOrder)) {
    return {
      ok: false,
      reason: `玩家不能使用「${order.order}」指令（势力存亡与归属由系统管理）`,
    }
  }

  // capture：owner 必须是玩家势力；不能占己方城市
  if (order.order === 'capture') {
    if (order.owner !== playerFaction) {
      return {
        ok: false,
        reason: `占领指令的归属势力「${order.owner}」与你的势力「${playerFaction}」不匹配——你只能为自己占领城市`,
      }
    }
    const gbId = resolveLocationId(order.gb!)
    if (gbId) {
      const currentOwner = cityOwnerFn(gbId)
      if (currentOwner === playerFaction) {
        const cityName = getLocationName(gbId)
        return { ok: false, reason: `${cityName || order.gb} 已是你方领土，无需占领` }
      }
    }
  }

  // moveTroops：调兵是后勤，目标城也须己方（不给敌方送兵）；且 amount 不得超过源城驻军
  if (order.order === 'moveTroops') {
    const toId = resolveLocationId(order.to!)
    if (toId) {
      const toOwner = cityOwnerFn(toId)
      if (toOwner !== undefined && toOwner !== playerFaction) {
        const cityName = getLocationName(toId)
        return { ok: false, reason: `目标城市「${cityName || order.to}」不属于你，调兵只能调往己方城` }
      }
    }
    const fromId = resolveLocationId(order.from!)
    if (fromId && cityTroopsFn) {
      const avail = cityTroopsFn(fromId)
      if (avail != null && typeof order.amount === 'number' && order.amount > avail) {
        const cityName = getLocationName(fromId)
        return { ok: false, reason: `调出兵力 ${order.amount}k 超过 ${cityName || order.from} 现存驻军 ${avail}k` }
      }
    }
  }

  // from 必须是己方城市
  if (order.from) {
    const fromId = resolveLocationId(order.from)
    if (fromId) {
      const fromOwner = cityOwnerFn(fromId)
      if (fromOwner !== undefined && fromOwner !== playerFaction) {
        const cityName = getLocationName(fromId)
        return {
          ok: false,
          reason: `出发城市「${cityName || order.from}」不属于你（由 ${fromOwner} 控制），你只能从己方城市出兵`,
        }
      }
    }
    // from 城市存在但归属未知（如 NEUTRAL）也不让出兵
    const fromId2 = resolveLocationId(order.from)
    if (fromId2 && cityOwnerFn(fromId2) === undefined) {
      // 中立或无主城市 —— 暂时放行（后续世界AI判）
    }
  }

  return { ok: true }
}

/**
 * 批量战略校验。返回通过 + 被拒两项列表 + 通用错误摘要。
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

/** 战局裁判的三档判断 */
export type WarVerdict = 'feasible' | 'difficult' | 'impossible'

/** 世界AI内部打分维度（仅作推理锚点，不展示给玩家） */
export interface WarScores {
  /** 地理可达性 0-5：行军路线多通畅？沿途多少敌对势力？ */
  geography: number
  /** 兵力可行度 0-5：进攻方能调动的兵力 vs 防守方×地势加成？ */
  military: number
  /** 政治连锁 0-5：此行动是否引发不可承受的外交/战略后果（越低越危险） */
  political: number
  /** 综合分 0-5 = geography×0.4 + military×0.3 + political×0.3 */
  overall: number
}

/** 世界AI校验返回的单条结果 */
export interface WorldValidationItem {
  index: number
  /** 三档判断 */
  verdict: WarVerdict
  /** 叙事理由（玩家可见）。feasible 时可简要确认；difficult/impossible 时需详细说明 */
  reason: string
  /** 替代建议（difficult 或 impossible 时给出，玩家可见） */
  suggestion?: string
  /** 内部推理分数（校验器内部用，不展示给玩家） */
  scores?: WarScores
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
  指令一览（共 13 条）
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
   - owner  （必填）：新控制势力，填枚举码 KMT / CCP / JPN / NEA / SHX / GXC / SCC / MA / XJ / TIB / NEUTRAL
   - resultTroops（可选）：占领后新驻军数量，单位 k；不传则仅易主、驻军保持不变

10. moveTroops — 调兵（从 A 城搬运 N 千兵到 B 城，演出：黄点弧线行军；动画播完后落地：A 减 N、B 加 N）
   - from  （必填）：出发城市中文名
   - to    （必填）：目标城市中文名（god-mode 可任意两城；玩家模式限己方城）
   - amount（必填）：搬运兵力，单位 k，须为正数

11. setFactionAlive — 设置势力存活状态
    - faction（必填）：目标势力枚举码（同上）
    - alive   （必填）：true = 加入存活列表；false = 移除（灭亡）

12. setCurrentDate — 推进全局日期（必须放 orders 数组最后一项）
    - date（必填）：ISO 日期字符串，如 "1937-07-07"

13. setCurrentFaction — 切换玩家操控势力
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
{"orders":[{"order":"capture","gb":"上海","owner":"KMT","resultTroops":20}],"msg":"已命上海守军易帜归 KMT。"}

批量指令（orders 数组按顺序执行，setCurrentDate 放在最后）：
{"orders":[
  {"order":"setFactionAlive","faction":"JPN","alive":true},
  {"order":"arrowFly","from":"北京","to":"上海","text":"猛攻！"},
  {"order":"setCurrentDate","date":"1937-07-07"}
],"msg":"日军 activation，华北攻势展开，时间推进至卢沟桥事变。"}`

// ── 统一玩家 AI Prompt（一次调用：生成指令 + 判断可行性）──

export const PLAYER_AI_UNIFIED_PROMPT = `你是民国军阀推演游戏中的玩家军师——兼具「军事参谋」与「战局推演者」双重身份。

═══════════════════════════════════════
  核心职责
═══════════════════════════════════════

收到玩家指令后，你需要同时完成两件事：
1. 将玩家意图转化为游戏指令（arrowFly / battle / capture 等）
2. 判断每条指令在当前局势下是否可行

═══════════════════════════════════════
  战略可行判断
═══════════════════════════════════════

从三个维度综合推演每条指令的可行性（0-5 分）：

1. 地理可达性（权重 0.4）—— 行军路线经过哪些势力？有无天然屏障（秦岭、长江、大漠）？0=完全不可达（新疆→杭州），5=邻接
2. 兵力可行度（权重 0.3）—— 己方可调动多少兵力 vs 防守方×地形加成？0=毫无胜算，5=明显优势
3. 政治连锁（权重 0.3）—— 是否引发不可承受的外交后果？攻击核心城市（如南京）？0=自杀式挑衅，5=无关痛痒

综合分 = geography×0.4 + military×0.3 + political×0.3

三档判断：
- ✅ feasible（可行）：综合分 ≥ 3.5，指令合理可行，直接执行。reason 简要确认。
- ⚠ difficult（困难）：综合分 2.0~3.4，存在明显障碍但非绝对不可能。reason 说明障碍，suggestion 给具体前置步骤。
- ❌ impossible（不可行）：综合分 < 2.0 或存在不可逾越阻断。reason 用叙事语言解释，suggestion 给替代方向。

═══════════════════════════════════════
  指令权限约束
═══════════════════════════════════════

- from 必须是玩家自己控制的城市；你只能为本势力决策
- 严禁使用 setFactionAlive / setCurrentFaction（系统管理）
- 你不会控制日期；日期推进由系统管理
- capture（占领）需前置 battle，不得直接占领未开战城市
- 若玩家未指明 from，从世界态中挑最近的己方城市作为出发地
- 所有地点用城市中文名

═══════════════════════════════════════
  输出格式（必须严格遵守）
═══════════════════════════════════════

你必须只返回一个 JSON 对象，不输出包裹之外的文字：

{
  "msg": "一句叙事总结（玩家可见，如'川军自重庆挥师东进，剑指杭州'）",
  "results": [
    {
      "order": {"order":"battle","from":"成都","to":"汉中"},
      "verdict": "feasible",
      "reason": "川陕相邻，汉中驻军不多，可行",
      "suggestion": null,
      "scores": {"geography":4,"military":4,"political":3,"overall":3.7}
    },
    {
      "order": {"order":"battle","from":"成都","to":"杭州"},
      "verdict": "impossible",
      "reason": "川军距杭州数千里，沿途需击穿KMT、SHX两道防线，以现有兵力无异于飞蛾扑火",
      "suggestion": "建议先经营陕南或鄂西走廊，逐城蚕食而非千里跃进",
      "scores": {"geography":0,"military":1,"political":0,"overall":0.3}
    }
  ]
}

注意：
- results 数组中每条对应玩家意图的一个行动，按执行顺序排列
- verdict 只能是 "feasible"、"difficult"、"impossible" 之一
- reason 必须是自然中文叙事，不是模板化规则语言
- suggestion 在 difficult/impossible 时必须填写，feasible 时填 null
- scores.overall 按公式计算，scores 仅供内部参考
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
   gb(必填) owner(必填,己方势力码) resultTroops(可选,k)

10. moveTroops — 调兵（己方两城间搬运驻军）
   from(必填,己方城) to(必填,己方城) amount(必填,k，不超过源城驻军)

═══════════════════════════════════════
  势力枚举值
═══════════════════════════════════════
KMT 国民政府 / CCP 中共苏区 / JPN 日本关东军
NEA 东北军 / SHX 晋系 / GXC 桂系 / SCC 川军
MA 马家军 / XJ 新疆 / TIB 西藏 / NEUTRAL 中立`

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