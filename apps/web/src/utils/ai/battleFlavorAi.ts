/**
 * 战斗调味 AI 模块
 *
 * 为战斗结算增加戏剧性叙事（P4a）。
 * 对外接口：flavorBattles(battles, baseResults) → Record<string, FlavorResult>
 *
 * 原文件：src/utils/aiPromptBuilder.ts buildBattleFlavorPrompt()
 *         + src/composables/useGameScheduler.ts settleActiveBattles() 的 AI 调用部分
 */
import { callLlm } from './client'
import { buildBattleFlavorSummary } from './prompts'
import { extractPayloads } from '@/utils/aiParse'
import type { BattleInfo } from '@/stores/game'
import type { BaseResult, FlavorResult, FlavorEvent } from '@/utils/battleFormula'

const FLAVOR_PROMPT = `你是民国军阀推演游戏中的"战地记者"。

═══════════════════════════════════════
  职责
═══════════════════════════════════════

你会收到进行中的战斗列表及本轮基础减员结果（由系统公式算出）。
你的工作是为战报增添戏剧色彩，而非改变战局。

═══════════════════════════════════════
  你可以做的（可选，大多数时候什么都不做）
═══════════════════════════════════════

1. shock（突发减员）：弹药库殉爆、主将阵亡、伏兵突袭、友军误击等意外。
   - magnitude 是额外伤亡（k），系统会封顶不超过该方基础减员的 50%。
   - 一场战斗里出现一两次就已足够，多了就不值钱了——大多数回合不应有 shock。

2. morale（士气扰动）：援军消息、瘟疫蔓延、叛逃哗变、捷报等。
   - delta 是士气变化量（正=提振，负=打击），系统会封顶不超过 ±20。
   - 士气事件可以比 shock 稍频繁，但也不要每回合都编——"什么都没发生"才是战场常态。

═══════════════════════════════════════
  关键原则
═══════════════════════════════════════

- 大多数回合 events 应为空数组 []。
- 突发事件是稀缺的戏剧高潮，不要每回合都输出。
- 如果你本轮确实没有值得报告的突发，直接返回空 events，不要硬编。
- 你不需要判定谁胜谁负——终局由系统检查。
- narrative 用一句话描述本轮战况，可参考但勿照抄基础减员数字。

═══════════════════════════════════════
  输出格式
═══════════════════════════════════════

必须只返回一个 JSON 对象：
{
  "results": [
    {
      "battleId": "battle_1",
      "events": [
        { "type": "shock", "side": "defender", "magnitude": 120, "narrative": "守军弹药库中弹殉爆" },
        { "type": "morale", "side": "attacker", "delta": -15, "narrative": "攻方主将阵亡，军心动摇" }
      ],
      "narrative": "奉天城下激战终日，东北军据城死守"
    }
  ]
}

注意：
- 每场战斗必须对应一条 results，不能遗漏
- events 可以为空数组
- magnitude 是千（k），正整数
- morale 的 delta 可正可负`

export async function flavorBattles(
  battles: BattleInfo[],
  baseResults: Map<string, BaseResult>,
): Promise<Record<string, FlavorResult>> {
  const flavorMap: Record<string, FlavorResult> = {}

  if (!battles.length) return flavorMap

  try {
    const summary = buildBattleFlavorSummary(battles, baseResults)
    if (!summary) return flavorMap

    const raw = await callLlm({
      messages: [
        { role: 'system', content: FLAVOR_PROMPT },
        { role: 'user', content: summary },
      ],
      maxRetries: 2,
    })

    const payloads = extractPayloads(raw)
    const obj = payloads[0] as Record<string, unknown> | undefined
    const list = (obj?.results as Array<{
      battleId?: string
      events?: FlavorEvent[]
      narrative?: string
    }>) ?? []

    for (const r of list) {
      if (r.battleId) {
        flavorMap[r.battleId] = { events: r.events ?? [], narrative: r.narrative }
      }
    }
  } catch {
    // 调味失败不阻塞战斗结算
  }

  return flavorMap
}
