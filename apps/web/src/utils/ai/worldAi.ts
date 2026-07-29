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
import type { GameOrder } from '@/utils/gameOrders'

const BATCH_PROMPT = `你是民国军阀推演游戏的「世界 AI」。你负责为次要势力生成本回合的行动。
这些势力不单独配 AI 实例，由你一次性批量生成它们的带日期事件。

上下文中的城市信息使用紧凑格式：
  城名 驻军Xk 士气X 地形 L城级 工事X
  - 驻军：单位千（k）；士气：0-100
  - 地形：山地/丘陵/平原/林地；L城级：城市等级 1-5
  - 工事：0-100，越高城防越强
  （工业/粮食/工事数值范围均为 0-100）

返回格式：
{
  "orders": [
    { "order": "battle", "from": "城A", "to": "城B", "actor": "势力中文名" },
    ...
  ]
}

约束：
- 每条指令必须带 actor（指明是哪个势力，用中文名，如"晋系"/"马家军"）
- 只生成合理、小型的行动（调兵/试探进攻），不要改变大局
- 保守为上——次要势力通常按兵不动
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
 * 返回通过结构校验的指令列表（调用方负责战略校验 + 入队）。
 */
export async function runWorldBatch(context: string): Promise<GameOrder[]> {
  const result = await invokeAgentDecision({
    systemPrompt: BATCH_PROMPT,
    userContext: context,
  })
  return result.parseSucceeded ? result.orders : []
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
      { role: 'system', content: SETTLE_PROMPT },
      { role: 'user', content: buildSettleContext(currentDate) },
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
