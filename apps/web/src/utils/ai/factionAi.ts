/**
 * 政权 AI 决策模块
 *
 * 为单个政权调 LLM 生成本回合行动（P3）。
 * 对外接口：decideFaction(faction, context) → { orders, telegram? }
 *
 * 原文件：src/composables/useAgentKernel.ts invokeFactionAI()
 */
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { extractPayloads } from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'
import type { DiplomacyIntent, Condition } from '@/utils/diplomacy'
import { parseConditions } from '@/utils/aiDiplomacy'

import { invokeAgentDecision } from './invoke'
import { buildFactionSystemPrompt } from './prompts'
import { validateFactionOrders } from './contract'
import { commandReceipt } from '@/utils/commandFeedback'
import type { AiStatus } from '@/utils/aiStatus'
import type { LlmControlOpts } from '@/composables/useLlmClient'
import { throwIfAiAborted, withAiAbort } from '@/utils/aiWait'

export interface DiplomaticProposal {
  target: Owner
  intent: DiplomacyIntent
  message: string
  conditions?: Condition[]
}

export interface FactionDecision {
  orders: GameOrder[]
  decisionStatus?: Pick<AiStatus, 'status' | 'reason'>
  telegram?: string
  diplomaticProposal?: DiplomaticProposal
}

export async function decideFaction(faction: Owner, context: string, llmOpts: LlmControlOpts = {}): Promise<FactionDecision> {
  const store = useGameStore()
  context += `\n剩余回合行动点：${store.getActionPoints(faction)}/6；结束回合后恢复。每条开战/部署/调兵/内政耗1点；撤退和查询不耗点。禁止capture、日期指令与停战期进攻。`

  const result = await withAiAbort(() => invokeAgentDecision({
    systemPrompt: buildFactionSystemPrompt(faction),
    userContext: context,
    llmOpts,
  }), llmOpts.signal)
  // Refusal receipts below are effects too: late decisions cannot record them.
  throwIfAiAborted(llmOpts.signal)

  if (!result.parseSucceeded) {
    return { orders: [], decisionStatus: { status: 'failed', reason: 'format' } }
  }

  // 提取电报与外交提案（可选字段）
  let telegram: string | undefined
  let diplomaticProposal: DiplomaticProposal | undefined
  const payloads = extractPayloads(result.raw)
  if (payloads.length) {
    const obj = payloads[0] as Record<string, unknown> | undefined
    if (obj && typeof obj.telegram === 'string' && obj.telegram.trim()) {
      telegram = obj.telegram.trim()
    }
    if (obj && obj.diplomaticProposal && typeof obj.diplomaticProposal === 'object') {
      const dp = obj.diplomaticProposal as Record<string, unknown>
      const target = dp.target as Owner
      const intent = dp.intent as DiplomacyIntent
      const message = (dp.message as string) || ''
      if (target && target !== faction && store.activeFactions.includes(target)) {
        diplomaticProposal = {
          target,
          intent: intent || 'peace',
          message: message || `${faction} 派遣使者请求见面`,
          conditions: parseConditions(dp.conditions),
        }
      }
    }
  }

  // Pre-execution refusals must reach the next decision too, not disappear
  // before the scheduler. Trusted identity/balances; no payment or world effect.
  const recordRefusal = (order: GameOrder, reason: string) => {
    const balance = { points: store.getActionPoints(faction),
      silver: store.getTreasury(faction), food: store.getGranary(faction) }
    store.applyEvent(commandReceipt(faction, order, { ok: false, reason }, balance, balance))
  }
  result.orders.forEach((order, i) => {
    if (result.errors[i]?.length) recordRefusal(order, `结构预检拒绝：${result.errors[i]!.join('；')}`)
  })
  // 1. 结构校验通过的指令
  const structureOk = result.orders.filter((_, i) => !result.errors[i].length)
  // 2. 战略校验
  const strategic = validateFactionOrders(
    structureOk,
    faction,
    (gb) => store.ownership[gb],
    (gb) => store.cities[gb]?.troops,
  )
  strategic.rejected.forEach(item => recordRefusal(item.order, `战略预检拒绝：${item.reason}`))

  const rejected = result.errors.some(errors => errors.length) || strategic.rejected.length > 0
  return { orders: strategic.approved, telegram, diplomaticProposal,
    decisionStatus: rejected ? { status: 'partial', reason: 'filtered' }
      : { status: result.orders.length ? 'ok' : 'empty' } }
}
