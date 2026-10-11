/** Safe interruption metadata. Never persist provider errors or request contents. */
export type AiWaitReason = 'timeout' | 'cancelled' | 'superseded'

export class AiWaitError extends Error {
  constructor(readonly reason: AiWaitReason) {
    super(reason === 'timeout' ? 'AI 等待已到截止时间'
      : reason === 'cancelled' ? '已停止等待 AI 回复' : '旧世界请求已作废')
    this.name = 'AiWaitError'
  }
}

export function throwIfAiAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof AiWaitError
    ? signal.reason : new AiWaitError('cancelled')
}

export function aiFailureReason(error: unknown): 'timeout' | 'cancelled' | 'request' {
  if (error instanceof AiWaitError) return error.reason === 'timeout' ? 'timeout' : 'cancelled'
  return 'request'
}

/** Also bounds implementations/transports which ignore AbortSignal. Late results are consumed,
 * but cannot resolve this promise or reach the caller's effects. */
export function withAiAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof AiWaitError ? signal.reason : new AiWaitError('cancelled'))
    }
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => {
      throwIfAiAborted(signal)
      return operation()
    }).then(value => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) onAbort()
      else resolve(value)
    }, error => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

export function aiRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof AiWaitError ? signal.reason : new AiWaitError('cancelled'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason instanceof AiWaitError ? signal.reason : new AiWaitError('cancelled'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
