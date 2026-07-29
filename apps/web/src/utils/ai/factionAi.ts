/**
 * 政权 AI 决策模块
 *
 * 为单个政权调 LLM 生成本回合行动（P3）。
 * 对外接口：decideFaction(faction, context) → { orders, telegram? }
 *
 * 原文件：src/composables/useAgentKernel.ts invokeFactionAI()
 */
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { extractPayloads } from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'

import { invokeAgentDecision } from './invoke'
import { buildFactionSystemPrompt } from './prompts'
import { validateFactionOrders } from './contract'

export interface FactionDecision {
  orders: GameOrder[]
  telegram?: string
}

export async function decideFaction(faction: Owner, context: string): Promise<FactionDecision> {
  const store = useGameStore()

  const result = await invokeAgentDecision({
    systemPrompt: buildFactionSystemPrompt(faction),
    userContext: context,
  })

  if (!result.parseSucceeded) {
    return { orders: [] }
  }

  // 提取电报（可选字段）
  let telegram: string | undefined
  const payloads = extractPayloads(result.raw)
  if (payloads.length) {
    const obj = payloads[0] as Record<string, unknown> | undefined
    if (obj && typeof obj.telegram === 'string' && obj.telegram.trim()) {
      telegram = obj.telegram.trim()
    }
  }

  // 1. 结构校验通过的指令
  const structureOk = result.orders.filter((_, i) => !result.errors[i].length)
  // 2. 战略校验
  const strategic = validateFactionOrders(
    structureOk,
    faction,
    (gb) => store.ownership[gb],
    (gb) => store.cities[gb]?.troops,
  )

  return { orders: strategic.approved, telegram }
}
