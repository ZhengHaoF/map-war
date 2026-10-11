import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callLlm, type LlmAttemptUpdate } from '@/composables/useLlmClient'
import { AiWaitError } from '@/utils/aiWait'

const messages = [{ role: 'user', content: 'test context' }]
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const ok = (value: unknown = { ok: true }) => ({ ok: true, status: 200, json: async () => value })
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn<typeof fetch>()) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('bounded LLM fetch and retry', () => {
  it('does not issue a request when the shared signal is already stopped', async () => {
    const c = new AbortController()
    c.abort(new AiWaitError('timeout'))
    await expect(callLlm({ messages, signal: c.signal })).rejects.toMatchObject({ reason: 'timeout' })
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('stops waiting even if fetch ignores abort; a late response is not parsed', async () => {
    let release!: (value: Response) => void
    const json = vi.fn<() => Promise<object>>(async () => ({ late: true }))
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { release = resolve }))
    const c = new AbortController()
    const result = callLlm({ messages, signal: c.signal, attemptTimeoutMs: 90_000 }).catch(e => e)
    await flush()
    c.abort(new AiWaitError('cancelled'))
    expect(await result).toMatchObject({ reason: 'cancelled' })
    release({ ok: true, json } as unknown as Response)
    await flush()
    expect(json).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds a stalled success response body and discards its late JSON', async () => {
    let release!: (value: unknown) => void
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200,
      json: () => new Promise(resolve => { release = resolve }) } as Response)
    const result = callLlm({ messages, maxRetries: 1, attemptTimeoutMs: 100 }).catch(e => e)
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    expect(await result).toMatchObject({ reason: 'timeout' })
    release({ late: true })
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds an error response body as well as the fetch', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502,
      json: () => new Promise(() => {}) } as Response)
    const result = callLlm({ messages, maxRetries: 1, attemptTimeoutMs: 75 }).catch(e => e)
    await vi.advanceTimersByTimeAsync(75)
    expect(await result).toMatchObject({ reason: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retries a timed-out attempt and reports real attempt/backoff states', async () => {
    const updates: LlmAttemptUpdate[] = []
    let firstSignal!: AbortSignal
    vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
      firstSignal = opts!.signal!
      return new Promise(() => {})
    }).mockResolvedValueOnce(ok({ recovered: true }) as Response)
    const result = callLlm({ messages, maxRetries: 2, attemptTimeoutMs: 100,
      onAttempt: update => updates.push(update) })
    await vi.advanceTimersByTimeAsync(1100)
    expect(await result).toEqual({ recovered: true })
    expect(firstSignal.aborted).toBe(true)
    expect(updates).toEqual([
      { state: 'requesting', attempt: 1, maxAttempts: 2 },
      { state: 'retrying', attempt: 2, maxAttempts: 2, retryDelayMs: 1000 },
      { state: 'requesting', attempt: 2, maxAttempts: 2 },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancel during backoff clears the timer and never starts the next retry', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) } as Response)
    const c = new AbortController()
    const updates: LlmAttemptUpdate[] = []
    const result = callLlm({ messages, signal: c.signal, onAttempt: update => updates.push(update) }).catch(e => e)
    await flush()
    expect(updates.at(-1)?.state).toBe('retrying')
    c.abort(new AiWaitError('cancelled'))
    expect(await result).toMatchObject({ reason: 'cancelled' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('a shared deadline interrupts an in-flight attempt without a retry', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))
    const c = new AbortController()
    const result = callLlm({ messages, signal: c.signal, attemptTimeoutMs: 1000 }).catch(e => e)
    await vi.advanceTimersByTimeAsync(50)
    c.abort(new AiWaitError('timeout'))
    expect(await result).toMatchObject({ reason: 'timeout' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('4xx remains non-retryable and clears the per-attempt timer', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'unauthorized' }) } as Response)
    await expect(callLlm({ messages, attemptTimeoutMs: 1000 })).rejects.toThrow('unauthorized')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('invalid transport JSON is not retried and does not echo response fragments', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => { throw Error('private response fragment') } } as unknown as Response)
    await expect(callLlm({ messages, attemptTimeoutMs: 1000 })).rejects.toThrow('AI 响应不是有效 JSON')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('local cancellation/progress options never become HTTP payload fields', async () => {
    vi.mocked(fetch).mockResolvedValue(ok() as Response)
    const c = new AbortController()
    await callLlm({ messages, signal: c.signal, attemptTimeoutMs: 1000, onAttempt: () => {} })
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body).toEqual({ messages, response_format: { type: 'json_object' } })
    expect(vi.getTimerCount()).toBe(0)
  })
})
