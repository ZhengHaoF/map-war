/**
 * AI 决策公共包装 —— 统一「调 LLM → 解析 payloads → unwrapData → 结构校验」流程。
 *
 * 取代 useAgentKernel 内 3 处 invoke 函数（invokeFactionAI / invokeWorldAIBatch /
 * invokeWorldAISettle）的重复代码，#5.2 改动。
 *
 * 设计：
 * - 调 callLlm（重试策略集中在 useLlmClient）
 * - 解析失败不重试（重试 AI 同 prompt 大概率同结果，浪费 token）
 * - 战略校验不在此处（玩家/政权校验规则差异大，由调用方做）
 * - useAiDebug 暂不接入（user 模式 results[] 结构不同，保留独立解析路径；待后续迁移）
 */
import { callLlm, type LlmCallOpts } from '@/composables/useLlmClient'
import { extractPayloads, unwrapData } from '@/utils/aiParse'
import { validateOrders, type BatchValidation } from '@/utils/aiOrderContract'

export interface InvokeAgentDecisionOpts {
  systemPrompt: string
  userContext: string
  /** 透传给 callLlm 的额外选项（model / responseFormat / maxRetries） */
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

export interface InvokeAgentDecisionResult {
  /** 通过结构校验的指令（结构错的仍在 orders 数组中，errors[i] 标记） */
  orders: BatchValidation['orders']
  /** 与 orders 等长；空数组 = 该项通过结构校验 */
  errors: BatchValidation['errors']
  /** 是否全部通过（结构校验层） */
  allOk: boolean
  /** LLM 原始回包（用于调试 / 错误排查） */
  raw: unknown
  /** 解析是否成功（payloads 数组非空 + 至少一个 unwrapData 成功） */
  parseSucceeded: boolean
}

/**
 * 调 LLM + 解析 + 结构校验。返回结构化结果供调用方做战略校验 / 入队。
 */
export async function invokeAgentDecision(opts: InvokeAgentDecisionOpts): Promise<InvokeAgentDecisionResult> {
  const raw = await callLlm({
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userContext },
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
  // 合并多 payload：每条单独校验
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
