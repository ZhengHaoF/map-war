/**
 * AI 决策公共包装 —— 统一「调 LLM → 解析 payloads → unwrapData → 结构校验」流程。
 *
 * 设计：
 * - 调 callLlm（重试策略集中在 useLlmClient）
 * - 解析失败不重试（重试 AI 同 prompt 大概率同结果，浪费 token）
 * - 战略校验不在此处（玩家/政权校验规则差异大，由调用方做）
 */
import { callLlm, type LlmCallOpts } from '@/composables/useLlmClient'
import { extractPayloads, unwrapData } from '@/utils/aiParse'
import { validateOrders, type BatchValidation } from '@/utils/aiOrderContract'

export interface InvokeAgentDecisionOpts {
  systemPrompt: string
  userContext: string
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

export interface InvokeAgentDecisionResult {
  orders: BatchValidation['orders']
  errors: BatchValidation['errors']
  allOk: boolean
  raw: unknown
  parseSucceeded: boolean
}

export async function invokeAgentDecision(opts: InvokeAgentDecisionOpts): Promise<InvokeAgentDecisionResult> {
  const raw = await callLlm({
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'system', content: opts.userContext },
    ],
    ...(opts.llmOpts ?? {}),
  })
  const payloads = extractPayloads(raw)
  if (!payloads.length) {
    return {
      orders: [],
      errors: [],
      allOk: false,
      raw,
      parseSucceeded: false,
    }
  }
  const allOrders = []
  const allErrors: string[][] = []
  let allOk = true
  for (const p of payloads) {
    const unwrapped = unwrapData(p)
    const batch = validateOrders(unwrapped)
    for (let i = 0; i < batch.orders.length; i++) {
      allOrders.push(batch.orders[i])
      allErrors.push(batch.errors[i] ?? [])
      if (batch.errors[i]?.length) allOk = false
    }
  }
  return {
    orders: allOrders,
    errors: allErrors,
    allOk,
    raw,
    parseSucceeded: true,
  }
}
