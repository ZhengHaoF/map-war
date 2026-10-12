/**
 * 进程内限流与并发控制（单实例部署；多实例需在反向代理/网关层另做全局限流）。
 */

export type Clock = () => number;

/** 固定窗口计数器，按 key 统计；key 数量有上限，防止内存被大量伪造 key 撑爆。 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** 尝试消耗一次额度；返回 null 表示允许，否则返回需要等待的毫秒数 */
  tryConsume(key: string): number | null {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(t);
      if (!w && this.windows.size >= this.maxKeys) return this.windowMs; // 仍满：fail closed
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return Math.max(1, w.start + this.windowMs - t);
    w.count++;
    return null;
  }

  /** 撤销一次额度（例如全局限流拒绝后回退单客户端计数） */
  refund(key: string): void {
    const w = this.windows.get(key);
    if (w && w.count > 0) w.count--;
  }

  private prune(t: number): void {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}

export class QueueRejectedError extends Error {
  constructor(public readonly reason: 'queue_full' | 'queue_timeout') {
    super(reason === 'queue_full' ? 'AI 请求排队已满' : 'AI 请求排队超时');
    this.name = 'QueueRejectedError';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('请求已取消');
    this.name = 'AbortError';
  }
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

/** 带有界队列、排队超时与取消的信号量 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
    private readonly queueTimeoutMs: number,
  ) {}

  get activeCount(): number { return this.active; }
  get queuedCount(): number { return this.queue.length; }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new QueueRejectedError('queue_full'));

    return new Promise((resolve, reject) => {
      const remove = () => {
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
      };
      const onAbort = () => { remove(); waiter.cleanup(); reject(new AbortedError()); };
      const timer = setTimeout(() => { remove(); waiter.cleanup(); reject(new QueueRejectedError('queue_timeout')); }, this.queueTimeoutMs);
      const waiter: Waiter = {
        resolve,
        reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next.cleanup();
        next.resolve(this.makeRelease()); // 名额直接转交，active 不变
      } else {
        this.active--;
      }
    };
  }
}
