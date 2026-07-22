/**
 * useLlmClient / aiInvoke 单测
 * #5.1 + #5.2 改动：抽公共 LLM 客户端 + AI 决策包装
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { callLlm } from '../composables/useLlmClient'
import { invokeAgentDecision } from '../utils/aiInvoke'

// ── 1. callLlm 行为 ──
describe('callLlm', () => {
  beforeEach(() => {
    // 重置 fetch mock
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('成功响应：返回 JSON 解析后的对象', async () => {
    const mockRes = {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRes as any))

    const result = await callLlm({ messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toEqual({ choices: [{ message: { content: 'ok' } }] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('HTTP 5xx：重试 maxRetries 次后抛错', async () => {
    const mockRes = { ok: false, status: 500, json: async () => ({ error: 'server down' }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRes as any))

    await expect(
      callLlm({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 2 }),
    ).rejects.toThrow()
    // 2 次重试 → fetch 调 2 次
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('HTTP 4xx：直接抛错（不重试）', async () => {
    const mockRes = { ok: false, status: 400, json: async () => ({ detail: 'bad request' }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockRes as any))

    await expect(
      callLlm({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 3 }),
    ).rejects.toThrow('bad request')
    expect(fetch).toHaveBeenCalledTimes(1) // 不重试
  })

  it('网络错误：抛错并重试', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')))

    await expect(
      callLlm({ messages: [{ role: 'user', content: 'hi' }], maxRetries: 2 }),
    ).rejects.toThrow('network fail')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('透传 responseFormat / model 参数', async () => {
    const mockRes = { ok: true, status: 200, json: async () => ({ ok: 1 }) }
    const mockFetch = vi.fn().mockResolvedValue(mockRes as any)
    vi.stubGlobal('fetch', mockFetch)

    await callLlm({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4',
      responseFormat: { type: 'text' },
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('gpt-4')
    expect(body.response_format).toEqual({ type: 'text' })
  })
})

// ── 2. invokeAgentDecision 行为 ──
describe('invokeAgentDecision', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function mockLlmResponse(content: string): unknown {
    return { choices: [{ message: { content } }] }
  }

  it('合法 JSON 响应：返回 orders + errors', async () => {
    // 合法 fogCover 指令（无需城市解析），验证基础通路
    const validOrder = { order: 'fogCover' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLlmResponse(JSON.stringify({ orders: [validOrder] })),
      } as any),
    )

    const r = await invokeAgentDecision({ systemPrompt: 's', userContext: 'u' })
    expect(r.parseSucceeded).toBe(true)
    expect(r.orders.length).toBe(1)
    expect(r.errors[0].length).toBe(0) // 结构合法
    expect(r.allOk).toBe(true)
  })

  it('结构校验失败的指令：errors 标记', async () => {
    // 缺 owner（结构非法）
    const bad = { order: 'capture', gb: '北京' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLlmResponse(JSON.stringify({ orders: [bad] })),
      } as any),
    )

    const r = await invokeAgentDecision({ systemPrompt: 's', userContext: 'u' })
    expect(r.orders.length).toBe(1)
    expect(r.errors[0].length).toBeGreaterThan(0)
    expect(r.allOk).toBe(false)
  })

  it('解析失败（非 JSON）：parseSucceeded=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLlmResponse('不是 JSON，是中文叙事'),
      } as any),
    )

    const r = await invokeAgentDecision({ systemPrompt: 's', userContext: 'u' })
    expect(r.parseSucceeded).toBe(false)
    expect(r.orders.length).toBe(0)
  })

  it('裸 JSON 数组（无 orders/data 包装）：仍能解析', async () => {
    const orders = [{ order: 'fogCover' }]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockLlmResponse(JSON.stringify(orders)),
      } as any),
    )

    const r = await invokeAgentDecision({ systemPrompt: 's', userContext: 'u' })
    expect(r.parseSucceeded).toBe(true)
    expect(r.orders.length).toBe(1)
    expect(r.orders[0].order).toBe('fogCover')
  })

  it('LLM 失败：抛错（callLlm 已重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'fail' }),
      } as any),
    )

    await expect(invokeAgentDecision({ systemPrompt: 's', userContext: 'u' })).rejects.toThrow()
  })
})
