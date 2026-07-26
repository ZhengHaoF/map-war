/**
 * AI 回包解析工具 —— 纯函数，供编排器（useAgentKernel）与调试面板（useAiOrchestrator）共用。
 *
 * 从 useAiOrchestrator.ts 中抽取，不依赖任何 Vue / Pinia 响应式。
 */

/** 判断是否为统一 results 格式（有 results 数组且无 orders 键） */
interface UnifiedAiResponse {
  msg?: string | null
  results: { order: Record<string, unknown>; verdict: string; reason: string; suggestion?: string | null }[]
}

export function isUnifiedResult(obj: unknown): obj is UnifiedAiResponse {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.results) && o.orders === undefined
}

/** 从文本中抽取 JSON（支持 markdown fence / 裸 JSON / 截断容错） */
export function extractJson(text: string): unknown {
  let t = (text ?? '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fallthrough */
  }
  const start = t.search(/[[{]/)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  throw new Error('无法从 AI 回复中解析出 JSON')
}

/** 从 LLM 回包抽取待校验的 payload 数组（兼容 content 文本 与 tool_calls.arguments）。 */
export function extractPayloads(raw: unknown): unknown[] {
  const choice = ((raw as any)?.choices ?? [])[0]
  const message = choice?.message
  const payloads: unknown[] = []

  if (typeof message?.content === 'string' && message.content.trim()) {
    try {
      payloads.push(extractJson(message.content))
    } catch {
      /* 非 JSON 文本，留给上层报错 */
    }
  }
  const toolCalls = message?.tool_calls ?? []
  for (const tc of toolCalls) {
    try {
      payloads.push(JSON.parse(tc?.function?.arguments ?? '{}'))
    } catch {
      /* 忽略坏参数 */
    }
  }
  return payloads
}

/** 指令数组的顶层键 */
const ORDER_KEYS = ['orders', 'data'] as const

/** 从顶层对象取出指令数组 */
export function pickOrderArray(obj: unknown): unknown[] | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  for (const k of ORDER_KEYS) {
    const v = (obj as Record<string, unknown>)[k]
    if (Array.isArray(v)) return v
  }
  return null
}

export function isWrapped(obj: unknown): boolean {
  return pickOrderArray(obj) !== null
}

/** 拆掉 {orders:[...] | data:[...]} 外层，返回纯指令数组 */
export function unwrapData(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.flatMap((p) => (isWrapped(p) ? pickOrderArray(p)! : [p]))
  }
  return isWrapped(obj) ? pickOrderArray(obj)! : obj
}

/** 从顶层对象抽取 AI 的叙事回复（msg 字段，可选） */
export function extractAiMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const m = (obj as Record<string, unknown>).msg
  return typeof m === 'string' && m.trim() ? m.trim() : null
}

/** 自由行动事件（复用已有 reducer 事件类型） */
export interface FreeActionEffect {
  type: 'cityStatChange' | 'moraleChange' | 'produce' | 'moveTroops' | 'sendTelegram'
  targetGb?: string
  field?: string
  delta?: number
  amount?: number
  fromGb?: string
  toGb?: string
  // sendTelegram 专用字段
  to?: string      // 势力代号，如 'SHX'
  content?: string // 电报内容
}

/** 自由行动载荷 */
export interface FreeActionPayload {
  narrative: string
  success: boolean
  effects: FreeActionEffect[]
}

/** 自由行动响应格式 */
export interface FreeActionResult {
  msg?: string | null
  freeAction: FreeActionPayload
}

/** 判断是否为自由行动格式 */
export function isFreeActionResult(obj: unknown): obj is FreeActionResult {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  const fa = o.freeAction
  return !!fa && typeof fa === 'object' && !Array.isArray(fa) &&
    typeof (fa as Record<string, unknown>).narrative === 'string' &&
    Array.isArray((fa as Record<string, unknown>).effects)
}
