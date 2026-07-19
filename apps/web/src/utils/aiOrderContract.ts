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
import type { WorldStateSnapshot } from '@/stores/game'

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

  const needsFromTo: KnownOrder[] = ['arrowFly', 'orbBurst', 'battle']
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

// ── 玩家指令战略校验（硬编码规则，零 LLM 成本）──

export interface StrategicRuleResult {
  ok: boolean
  reason?: string
}

/** 需要 from 字段的指令类型 */
const FROM_REQUIRED_ORDERS: KnownOrder[] = ['arrowFly', 'radarPulse', 'orbBurst', 'battle']

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
): { approved: GameOrder[]; rejected: { order: GameOrder; reason: string }[] } {
  const approved: GameOrder[] = []
  const rejected: { order: GameOrder; reason: string }[] = []
  for (const o of orders) {
    const r = validatePlayerOrder(o, playerFaction, cityOwnerFn)
    if (r.ok) {
      approved.push(o)
    } else {
      rejected.push({ order: o, reason: r.reason || '未知原因' })
    }
  }
  return { approved, rejected }
}

// ── 世界 AI 校验 Prompt ──

/**
 * 世界AI校验系统提示词。
 * 把玩家代理 AI 产出的指令作为输入，由世界AI（god-mode 认知）逐条审查合法性。
 */
export function buildWorldValidationSystemPrompt(): string {
  return `你是民国军阀推演游戏的世界 AI 校验者。你的职责不是生成指令，而是审查玩家代理 AI 已经产出的指令，逐条判断其是否合法、合理。

你必须只返回一个 JSON 对象：
{
  "validations": [
    {
      "index": 0,
      "approved": true,
      "reason": "如果 rejected，必须给出简洁可读的中文理由（玩家会直接看到此文字）"
    },
    ...
  ],
  "summary": "一句话总结此次校验（如"3 条通过，1 条被拒"）"
}

审查规则（严格执行，不妥协）：
1. 玩家只能指挥自己势力——capture 的 owner 必须与玩家势力一致；任何试图替其他势力决策的指令一律拒绝。
2. 玩家不能占领已属于自己的城市。
3. 凡需要 from（出发城）的指令（arrowFly / radarPulse / orbBurst / battle），from 必须是玩家控制的城市。
4. setFactionAlive / setCurrentFaction 是系统指令，玩家绝对不可使用。
5. 战略合理性：明显跨越整个中国版图、穿越多个敌对势力领土的行军（如川军从重庆出兵满洲里）应拒绝并给出理由。
6. 若指令合理但参数缺失/不当，宁可拒绝也不要擅自补全——让玩家重新输入。`
}

/**
 * 构建世界AI校验的完整 messages。
 * @param orders    玩家代理 AI 产出的指令数组
 * @param userText  玩家原始输入
 * @param snapshot  当前世界态快照
 */
export function buildWorldValidationMessages(
  orders: GameOrder[],
  userText: string,
  snapshot: WorldStateSnapshot,
): { role: string; content: string }[] {
  const ordersText = JSON.stringify(
    orders.map((o, i) => ({ index: i, ...o })),
    null,
    2,
  )

  const contextLines: string[] = []
  contextLines.push(`当前日期：${snapshot.currentDate}`)
  contextLines.push(`玩家势力：${snapshot.currentFaction ?? '（未选）'}`)
  if (snapshot.currentFaction) {
    const myCities = Object.entries(snapshot.cities)
      .filter(([, c]) => c.owner === snapshot.currentFaction)
      .map(([gb, c]) => {
        const name = getLocationName(gb)
        return `${name || gb}（驻军 ${c.troops}k，士气 ${c.morale}）`
      })
    contextLines.push(`玩家控制城市：${myCities.join('、') || '无'}`)
  }
  contextLines.push(`存活势力：${snapshot.activeFactions.join('、')}`)

  // 标注指令涉及城市的归属
  const mentionedGbs = new Set<string>()
  for (const o of orders) {
    if (o.gb) mentionedGbs.add(resolveLocationId(o.gb) || o.gb)
    if (o.from) mentionedGbs.add(resolveLocationId(o.from) || o.from)
    if (o.to) mentionedGbs.add(resolveLocationId(o.to) || o.to)
  }
  if (mentionedGbs.size) {
    const cityInfo: string[] = []
    for (const gb of mentionedGbs) {
      const c = snapshot.cities[gb]
      const name = getLocationName(gb)
      cityInfo.push(
        c
          ? `  - ${name || gb}：归属 ${c.owner}（驻军 ${c.troops}k）`
          : `  - ${name || gb}：归属未知`,
      )
    }
    contextLines.push(`指令涉及城市归属：\n${cityInfo.join('\n')}`)
  }

  return [
    { role: 'system', content: buildWorldValidationSystemPrompt() },
    { role: 'user', content: `玩家输入：${userText}\n\n玩家代理 AI 产出指令：\n${ordersText}\n\n当前态势：\n${contextLines.join('\n')}` },
  ]
}

/** 世界AI校验返回的单条结果 */
export interface WorldValidationItem {
  index: number
  approved: boolean
  reason?: string
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
  指令一览（共 12 条）
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

10. setFactionAlive — 设置势力存活状态
    - faction（必填）：目标势力枚举码（同上）
    - alive   （必填）：true = 加入存活列表；false = 移除（灭亡）

11. setCurrentDate — 推进全局日期（必须放 orders 数组最后一项）
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
{"orders":[{"order":"capture","gb":"上海","owner":"KMT","resultTroops":20}],"msg":"已命上海守军易帜归 KMT。"}

批量指令（orders 数组按顺序执行，setCurrentDate 放在最后）：
{"orders":[
  {"order":"setFactionAlive","faction":"JPN","alive":true},
  {"order":"arrowFly","from":"北京","to":"上海","text":"猛攻！"},
  {"order":"setCurrentDate","date":"1937-07-07"}
],"msg":"日军 activation，华北攻势展开，时间推进至卢沟桥事变。"}`

/**
 * 用户 AI 提示词（玩家势力代理）。
 * 与 god-mode 契约共享同套 orders + msg 格式与地点参数规则，但去掉最高权限：
 * - 只能为本势力决策（from 须为己方城市），不得指挥他国、不得替其他势力决策。
 * - 禁止使用 setFactionAlive / setCurrentFaction（势力生死与玩家归属由世界 AI / 系统管）。
 */
export const USER_AI_SYSTEM_PROMPT = `你是民国军阀推演游戏中玩家所操控势力的代理 AI（默认川军 SCC）。你只为本势力做决策、下发指令，不能指挥或替其他势力决策。

你必须只返回一个 JSON 对象，固定包含两个顶层键：
- "orders"：指令数组，即使只有一条指令也必须放在数组中：{"orders":[{"order":"arrowFly",...}]}。数组中的指令按顺序执行。
- "msg"（可选）：一句话叙事/解释，作为给玩家看的剧情文字（如「川军自重庆挥师东进，剑指杭州」）。建议重大动作附带一句。
不要输出包裹 JSON 之外的多余解释文字（叙事请只放在 msg 字段）。所有地点都用城市中文名填写即可，无需任何编码。

指令权限约束（重要 —— 你的指令会被世界AI二次校验，违规指令将被驳回）：
- from 必须是玩家自己控制的城市；不得对其它势力名下城市发起进攻以外的指令，不得替其它势力决策。
- 严禁使用 setFactionAlive 与 setCurrentFaction（势力生死与玩家归属由系统管理，不开放给玩家）。
- 你不会控制日期——日期推进由世界 AI 在玩家结束回合时统一计算，你只负责本回合内的战术指令。
- capture（占领城市）指令需要谨慎使用：玩家必须已对该城市发起进攻（battle）或处于战争状态，不得直接占领未开战的城市。若玩家没有前置 battle，请勿直接发 capture，改用 battle 或 arrowFly 指令表示进军。
- 其余指令（arrowFly / radarPulse / orbBurst / battle / fogCover 等）参数与最高权限契约一致。

可选字段 needsPlayerDecision（布尔，默认 false）：若某条指令执行后需要把控制权交还给玩家（例如涉及己方重大抉择），在该条指令上追加 "needsPlayerDecision": true。调度器播放到此处会暂停、等待玩家决策。

若玩家指令未指明 from（如只说「进攻杭州」而不说从哪出兵），请从世界态中「玩家控制城市」里挑一座离目标城市地理最近的城市作为 from（结合地理常识判断）；若世界态未注入则自行合理推断一座己方城市。同理，未指明 to 时以对话涉及城市为准。

【地点参数说明】所有城市地点参数（arrowFly / radarPulse / orbBurst / battle 的 from / to，以及 capture 的 gb）请直接填城市中文名，系统会自动转换为内部编码。支持简称/简写，也兼容直接填 gb 编码，但优先用中文名。

═══════════════════════════════════════
  指令一览（玩家可用）
═══════════════════════════════════════

1. arrowFly — 箭头飞行动画（黄点弧线从 A 飞 B，纯视觉演出，不改世界态）
   - from（必填）：出发城市中文名（须为己方城市）
   - to  （必填）：目标城市中文名
   - text（可选）：行军弹字，如 "猛攻！"

2. radarPulse — 雷达脉冲动画（绿圈波环扩散扫描，纯视觉演出，不改世界态）
   - from（必填）：出发城市中文名（须为己方城市）
   - text（可选）：弹字

3. orbBurst — 光球爆炸动画（红光球抛射+引爆+震波，纯视觉演出，不改世界态）
   - from（必填）：起点城市中文名（须为己方）
   - to  （必填）：目标城市中文名
   - text（可选）：弹字

4. battle — 开启持续战斗（演出：双向交火持续动画，直到 stopBattle）
   - from（必填）：A 方城市中文名（须为己方）
   - to  （必填）：B 方城市中文名
   - text（可选）：覆盖弹字文案

5. stopBattle — 停止指定战斗
   - id（必填）：战斗 id

6. stopBattles — 停止所有进行中的战斗（无参数）

7. listBattles — 查询进行中战斗列表（无参数）

8. fogCover — 云雾遮罩动画（全屏云雾盖屏→停顿→揭开，纯视觉演出，不改世界态）

9. capture — 占领/接收城市（⚠ 需前置 battle：玩家必须先对该城发起进攻 battle，才能使用 capture 占领）
   - gb     （必填）：目标城市中文名
   - owner  （必填）：新控制势力，必须填己方势力枚举码
   - resultTroops（可选）：占领后新驻军数量，单位 k

═══════════════════════════════════════
  势力枚举值（capture 的 owner 可填）
═══════════════════════════════════════
KMT  国民政府    CCP  中共苏区      JPN  日本关东军
NEA  东北军      SHX  晋系          GXC  桂系
SCC  川军        MA   马家军        XJ   新疆
TIB  西藏        NEUTRAL 中立

═══════════════════════════════════════
  示例
═══════════════════════════════════════

进攻（先 battle，不要直接 capture）：
{"orders":[{"order":"battle","from":"成都","to":"西安","text":"川军北出剑门关！"}],"msg":"川军对西安发起进攻。"}

行军展示（不改世界态）：
{"orders":[{"order":"arrowFly","from":"成都","to":"重庆","text":"东进！"}],"msg":"川军自成都出击，剑指重庆。"}

批量指令（orders 数组按顺序执行）：
{"orders":[
  {"order":"arrowFly","from":"成都","to":"西安","text":"北上！"},
  {"order":"arrowFly","from":"重庆","to":"贵阳","text":"南征！"}
],"msg":"川军双线出击，剑指西安与贵阳。"}`
