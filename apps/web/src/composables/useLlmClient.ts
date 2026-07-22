/**
 * 通用 LLM HTTP 客户端（无 Vue 响应式，适合并行调用）。
 *
 * 取代 useAgentKernel.callAI 内的 fetch + 退避重试，#5.1 改动。
 * 与 useAiChat（UI 友好型 loading/error）定位不同：useLlmClient 是底层工具，
 * useAgentKernel / 未来的批量调用都走这里。
 *
 * 重试策略：
 * - 网络错误 / HTTP 5xx：退避重试
 * - 4xx：抛错（客户端错误重试无用）
 * - JSON 解析失败：抛错（重试需走 invokeAgentDecision，附加 hint）
 */
export interface LlmCallOpts {
  messages: { role: string; content: string }[]
  /** response_format，默认 { type: 'json_object' }。需纯文本传 { type: 'text' } */
  responseFormat?: { type: 'text' | 'json_object' | 'json_schema' }
  /** 网络错误重试次数（含首次），默认 3 */
  maxRetries?: number
  /** 覆盖模型名（默认用后端配置） */
  model?: string
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RESPONSE_FORMAT: LlmCallOpts['responseFormat'] = { type: 'json_object' }

/**
 * 标记客户端错误（4xx），外层 catch 不会重试
 */
class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

/**
 * 单次 LLM 调用（带退避重试）。返回后端 chat.completions.create 的原始回包。
 *
 * 重试策略：
 * - 4xx 客户端错误 → NonRetryableError（不重试，参数错重试无用）
 * - 5xx / 网络错误 → 退避重试 maxRetries 次
 * - JSON 解析失败 → 抛错（重试需走 invokeAgentDecision，附加 hint）
 *
 * @throws 网络/HTTP 错误经重试仍失败；调用方需 catch
 */
export async function callLlm(opts: LlmCallOpts): Promise<unknown> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const responseFormat = opts.responseFormat ?? DEFAULT_RESPONSE_FORMAT
  let lastErr: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' } as Record<string, string>,
        body: JSON.stringify({
          ...(opts.model ? { model: opts.model } : {}),
          messages: opts.messages,
          response_format: responseFormat,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const detail =
          (errBody as { detail?: string })?.detail ??
          (errBody as { error?: string })?.error ??
          `HTTP ${res.status}`
        // 4xx 客户端错误：NonRetryableError，绕过外层重试
        if (res.status >= 400 && res.status < 500) {
          throw new NonRetryableError(detail)
        }
        throw new Error(`5xx: ${detail}`)
      }
      return await res.json()
    } catch (err) {
      // 客户端错误不重试，直接 rethrow
      if (err instanceof NonRetryableError) {
        throw err
      }
      lastErr = err as Error
      if (attempt < maxRetries) {
        // 退避：1s / 2s / 3s ...
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastErr ?? new Error('AI 调用失败')
}
