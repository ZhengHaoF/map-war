import { describe, expect, it, vi } from 'vitest'
import { aiErrorMessage } from '@/utils/aiError'
import { useAiChat } from '@/composables/useAiChat'

describe('readable model errors', () => {
  it.each([
    [{ detail: '无效参数' }, 400, '无效参数'],
    [{ error: '请求未获授权' }, 401, '请求未获授权'],
    [{ error: { message: '错误格式' } }, 400, '错误格式'],
    [{ message: '不支持的模型' }, 400, '不支持的模型'],
    [null, 400, '模型请求失败（HTTP 400）'],
    [{ error: { message: 'upstream request failed' } }, 502, '模型服务暂未响应（HTTP 502），请稍后重试'],
  ])('normalizes %j / %i', (body, status, expected) => {
    expect(aiErrorMessage(body, status as number)).toBe(expected)
    expect(aiErrorMessage(body, status as number)).not.toContain('[object Object]')
  })
  it('UI client exposes readable nested error without a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn<() => Promise<object>>().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ error: { message: 'upstream request failed' } }),
    }))
    try {
      const chat = useAiChat()
      await chat.send({ messages: [{ role: 'user', content: '原始指令' }] })
      expect(chat.error.value).toContain('HTTP 502')
      expect(chat.response.value).toBeNull()
      expect(chat.loading.value).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
