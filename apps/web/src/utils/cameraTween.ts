/**
 * 相机补间器（从 LeafletMap.animateCameraTo 抽出，便于单测）。
 *
 * 语义保证：
 * - 任何一次 tweenTo() 返回的 promise **一定会 resolve**：自然结束、被下一次 tweenTo 顶替、
 *   cancel()、signal abort 都会 resolve（修复旧实现被顶替时旧 promise 永远挂起的问题）。
 * - 默认缓动 easeOutCubic，与旧行为一致；可选自定义缓动与 AbortSignal。
 * - 减少动态偏好：直接归位，不补间。
 */
export interface CameraState {
  scale: number
  x: number
  y: number
}

export interface CameraTweenOptions {
  ease?: (t: number) => number
  signal?: AbortSignal
}

export interface CameraTweenDeps {
  get(): CameraState
  set(s: CameraState): void
  reducedMotion(): boolean
  raf?: (cb: (now: number) => void) => number
  caf?: (id: number) => void
  now?: () => number
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export interface CameraTweener {
  tweenTo(target: CameraState, duration: number, opts?: CameraTweenOptions): Promise<void>
  /** 停止当前补间（相机停在当前位置），并 resolve 挂起的 promise。 */
  cancel(): void
  /** 是否有补间在进行 */
  readonly active: boolean
}

export function createCameraTweener(deps: CameraTweenDeps): CameraTweener {
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb))
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id))
  const now = deps.now ?? (() => performance.now())
  let rafId: number | null = null
  let pendingResolve: (() => void) | null = null
  let pendingCleanup: (() => void) | null = null

  function settle(): void {
    if (rafId !== null) {
      caf(rafId)
      rafId = null
    }
    const r = pendingResolve
    const c = pendingCleanup
    pendingResolve = null
    pendingCleanup = null
    c?.()
    r?.()
  }

  function tweenTo(target: CameraState, duration: number, opts: CameraTweenOptions = {}): Promise<void> {
    // 顶替：旧补间停止，旧 promise 立即 resolve
    settle()
    return new Promise<void>((resolve) => {
      if (opts.signal?.aborted) {
        resolve()
        return
      }
      if (deps.reducedMotion() || !(duration > 0)) {
        deps.set({ ...target })
        resolve()
        return
      }
      const ease = opts.ease ?? easeOutCubic
      const start = deps.get()
      const startTime = now()
      pendingResolve = resolve
      const onAbort = (): void => {
        if (pendingResolve === resolve) settle()
      }
      if (opts.signal) {
        opts.signal.addEventListener('abort', onAbort, { once: true })
        pendingCleanup = () => opts.signal!.removeEventListener('abort', onAbort)
      }
      const step = (t: number): void => {
        rafId = null
        if (pendingResolve !== resolve) return
        const p = Math.min(Math.max((t - startTime) / duration, 0), 1)
        const e = ease(p)
        deps.set({
          scale: start.scale + (target.scale - start.scale) * e,
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
        })
        if (p < 1) rafId = raf(step)
        else settle()
      }
      rafId = raf(step)
    })
  }

  return {
    tweenTo,
    cancel: settle,
    get active() {
      return pendingResolve !== null
    },
  }
}
