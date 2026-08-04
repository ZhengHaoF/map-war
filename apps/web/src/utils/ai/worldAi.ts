/**
 * 世界 AI 模块
 *
 * 负责次要势力批量决策（P3）和回合结算叙事（P4）。
 * 对外接口：
 *   runWorldBatch(context) → GameOrder[]
 *   runWorldSettle(currentDate) → { narrative, newDate, chatter }
 *
 * 原文件：src/composables/useAgentKernel.ts
 *   invokeWorldAIBatch() + invokeWorldAISettle()
 */
import { callLlm } from './client'
import { invokeAgentDecision } from './invoke'
import { buildSettleContext } from './context'
import { extractPayloads } from '@/utils/aiParse'
import { buildScenarioBrief } from '@/data/scenarioBrief'
import type { GameOrder } from '@/utils/gameOrders'

const BATCH_PROMPT = `你是民国军阀推演游戏的「世界 AI」。你负责为次要势力生成本回合的行动。
这些势力不单独配 AI 实例，由你一次性批量生成它们的带日期事件。

上下文中的城市信息使用紧凑格式：
  城名 驻军Xk 士气X 地形 L城级 工事X
  - 驻军：单位千（k）；士气：0-100
  - 地形：山地/丘陵/平原/林地；L城级：城市等级 1-5
  - 工事：0-100，越高城防越强
  （工业/粮食/工事数值范围均为 0-100）

═══════════════════════════════════════
  可用指令（只允许以下 5 种，每条必须带 actor）
═══════════════════════════════════════

- battle:     from(己方城) to(目标城) actor — 试探性进攻
- moveTroops: from(己方源城) to(己方目标城) amount(正数,千) actor — 调兵
- recruit:    gb(己方城) amount(正数,千) actor — 征兵
- develop:    gb(己方城) field("industry"/"food") amount(正数) actor — 建设（提升工业或粮食）
- fortify:    gb(己方城) amount(正数) actor — 筑防（提升工事）

⚠ 调兵就是 moveTroops——系统里没有名为 move 的指令，写了 move 会被直接丢弃。
⚠ 严禁使用 capture / deploy / stopBattle / 任何系统指令（setCurrentDate / setFactionAlive 等）。

返回 JSON 格式：
{
  "orders": [
    { "order": "battle", "from": "城A", "to": "城B", "actor": "势力中文名" },
    { "order": "moveTroops", "from": "城C", "to": "城D", "amount": 5, "actor": "势力中文名" }
  ]
}

约束：
- 每条指令必须带 actor（指明是哪个势力，用中文名，如"晋系"/"马家军"）
- 只生成合理、小型的行动（调兵/试探进攻/低调内政），不要改变大局
- 保守为上——次要势力通常按兵不动，无行动就返回空 orders 数组 []
- 所有地点用城市中文名`

const SETTLE_PROMPT = `你是民国军阀推演游戏的「世界 AI」叙事者。本回合各势力的行动已经执行完毕。

请产出：
1. narrative: 2-4 句中文叙事，总结本回合重大事件
2. newDate: 推进后的新日期（ISO 格式），通常推进 5-10 天
3. chatter: 1-3 条势力时局短评（世界公屏电报）。以 1-3 个势力的口吻，对本回合局势各发表一句短评。
   - 可以是吃瓜、嘲讽、放话、感慨，不一定跟玩家有关
   - 每条 20-40 字，性格鲜明，半文言
   - from 用势力中文名（国民政府、中共苏区、日本关东军、东北军、晋系、桂系、川军、马家军、新疆、西藏），name 用领袖名
   - 如果本回合没什么大事，chatter 可以为空数组 []

返回 JSON 格式：
{ "narrative": "全境战报…", "newDate": "1931-04-10", "chatter": [{ "name": "蒋介石", "from": "国民政府", "content": "…" }] }`

/**
 * P3 批量次要势力决策。
 * 返回指令列表 + 逐条结构校验错误 + 解析是否成功（调用方负责"结构非法即跳过"门卫 + 战略校验 + 入队）。
 *
 * 注意：orders 中包含结构校验失败的原始项（validateOrders 会保留原文便于回显），
 * 调用方必须用 errors[i] 是否非空来跳过非法指令，否则非法指令会漏到执行层。
 */
export interface WorldBatchResult {
  orders: GameOrder[]
  errors: string[][]
  parseSucceeded: boolean
}

export async function runWorldBatch(context: string): Promise<WorldBatchResult> {
  const result = await invokeAgentDecision({
    systemPrompt: BATCH_PROMPT + '\n\n' + buildScenarioBrief(),
    userContext: context,
  })
  if (!result.parseSucceeded) {
    return { orders: [], errors: [], parseSucceeded: false }
  }
  return { orders: result.orders, errors: result.errors, parseSucceeded: true }
}

export interface WorldSettleResult {
  narrative: string
  newDate: string
  chatter: { name?: string; from: string; content: string }[]
}

/**
 * P4 回合结算叙事。
 * 返回叙事文本、新日期、世界公屏电报。
 */
export async function runWorldSettle(currentDate: string): Promise<WorldSettleResult> {
  const raw = await callLlm({
    messages: [
      { role: 'system', content: SETTLE_PROMPT + '\n\n' + buildScenarioBrief() },
      { role: 'system', content: buildSettleContext(currentDate) },
    ],
  })
  const payloads = extractPayloads(raw)
  const obj = payloads[0] as Record<string, unknown> | undefined
  return {
    narrative: (obj?.narrative as string) ?? '局势在无声中演变…',
    newDate: (obj?.newDate as string) ?? currentDate,
    chatter: Array.isArray(obj?.chatter)
      ? (obj.chatter as { name?: string; from: string; content: string }[]).filter(
          (c) => c && typeof c.from === 'string' && typeof c.content === 'string' && c.content.trim(),
        )
      : [],
  }
}
