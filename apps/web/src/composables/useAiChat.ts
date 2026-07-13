import { ref } from 'vue'

export interface AiChatRequest {
  messages: { role: string; content: string }[]
  tools?: unknown[]
  model?: string
  temperature?: number
  /**
   * 可选：强制模型输出格式。后端默认注入 `{ type: 'json_object' }`（结构化指令）。
   * 如需纯文本回复，可显式传 `{ type: 'text' }` 覆盖默认。
   */
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; [key: string]: unknown }
  [key: string]: unknown
}

export function useAiChat() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const response = ref<unknown>(null)

  async function send(body: AiChatRequest) {
    loading.value = true
    error.value = null
    response.value = null

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const detail =
          (errBody as { detail?: string })?.detail ??
          (errBody as { error?: string })?.error ??
          `HTTP ${res.status}`
        throw new Error(detail)
      }

      response.value = await res.json()
    } catch (err) {
      error.value = (err as Error).message || '未知错误'
    } finally {
      loading.value = false
    }
  }

  function reset() {
    loading.value = false
    error.value = null
    response.value = null
  }

  return { loading, error, response, send, reset }
}
