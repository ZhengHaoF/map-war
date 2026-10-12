/**
 * 新局开场导演：唯一主时钟 + 唯一结束出口。
 *
 * - 只读世界：通过 IntroMapPort 读取地图 / 设置相机 / 管理入场专用 Pixi 层，不调用 applyEvent。
 * - 第一、二幕只用 DOM；到地图闸门（第三幕揭图前）才要求地图 ready，未 ready 时停在题年等待，
 *   超时或核心加载失败进入 error 状态，并**释放输入锁**，展示重试 / 返回。
 * - 任何退出（完成 / 跳过 / 取消 / 失败）都经 finish()：停 RAF、清定时器、销毁入场层、释放锁、
 *   resolve start() 的 promise；可重复调用，幂等。
 * - 仅当世界未被替换（worldToken 不变）时才把终态镜头写回地图。
 */
import {
  cameraKey,
  computeFrame,
  cuesBetween,
  durationFor,
  mapGateFor,
  type CueKind,
  type IntroFrame,
} from './introTimeline'
import { lerpShot, type IntroCast, type IntroShots, type Shot } from './introPlan'

export type MapReadyResult = { ok: true } | { ok: false; reason: string }
export type MapReadyState = 'pending' | 'ready' | 'failed'

export interface IntroMapPort {
  readyState(): MapReadyState
  /** 地图首次图层 / 城市注册 / 字体（或其超时）全部就绪后 resolve；核心失败 resolve {ok:false}。不得 reject。 */
  whenReady(): Promise<MapReadyResult>
  /** 核心加载失败后重试一次（重新拉取图层）。不得 reject。 */
  retryLoad(): Promise<MapReadyResult>
  /** 以当前视口计算取景；数据不足返回 null。 */
  computeShots(cast: IntroCast): IntroShots | null
  /** 构建入场专用 Pixi 层（不进 worldContainer / labelContainer）。可抛错，导演会降级为无层。 */
  buildLayer(cast: IntroCast): void
  /** 每帧：设置相机到 shot，并按帧参数更新入场层透明度等。 */
  render(frame: IntroFrame, shot: Shot): void
  /** 终态：只设相机，不做补间。 */
  setFinalCamera(shot: Shot): void
  destroyLayer(): void
  /** 获取入场输入锁；返回释放函数（重复调用安全）。 */
  acquireLock(): () => void
  /** 当前世界身份：读档 / 换局后变化 */
  worldToken(): string
}

export interface IntroClock {
  raf(cb: (now: number) => void): number
  caf(id: number): void
  now(): number
  setTimeout(cb: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export const defaultIntroClock = (): IntroClock => ({
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
})

export type IntroStatus = 'playing' | 'waiting' | 'error' | 'done'
export type IntroOutcome = 'completed' | 'skipped' | 'cancelled' | 'failed'

export interface IntroDirectorOptions {
  port: IntroMapPort
  cast: IntroCast
  reduced: boolean
  /** 地图闸门等待上限，超时进入 error（解除锁）。默认 15s。 */
  readyTimeoutMs?: number
  clock?: IntroClock
  onFrame?: (t: number, frame: IntroFrame) => void
  onStatus?: (status: IntroStatus, detail: { error?: string; outcome?: IntroOutcome }) => void
  onCue?: (kind: CueKind) => void
  isHidden?: () => boolean
}

export const DEFAULT_READY_TIMEOUT_MS = 15000

export class IntroDirector {
  readonly reduced: boolean
  readonly duration: number
  private readonly gate: number
  private readonly port: IntroMapPort
  private readonly clock: IntroClock
  private readonly opts: IntroDirectorOptions
  private readonly cast: IntroCast
  private readonly startToken: string
  private _t = 0
  private _status: IntroStatus = 'playing'
  private _outcome: IntroOutcome | null = null
  private _error = ''
  private shots: IntroShots | null = null
  private rafId: number | null = null
  private last = 0
  private release: (() => void) | null = null
  private waitTimer: unknown = null
  private waitSeq = 0
  private skipRequested = false
  private started = false
  private resolveDone!: (o: IntroOutcome) => void
  readonly done: Promise<IntroOutcome>

  constructor(opts: IntroDirectorOptions) {
    this.opts = opts
    this.port = opts.port
    this.cast = opts.cast
    this.reduced = opts.reduced
    this.duration = durationFor(opts.reduced)
    this.gate = mapGateFor(opts.reduced)
    this.clock = opts.clock ?? defaultIntroClock()
    this.startToken = opts.port.worldToken()
    this.done = new Promise<IntroOutcome>((r) => (this.resolveDone = r))
  }

  get t(): number {
    return this._t
  }
  get status(): IntroStatus {
    return this._status
  }
  get outcome(): IntroOutcome | null {
    return this._outcome
  }
  get error(): string {
    return this._error
  }
  get locked(): boolean {
    return this.release !== null
  }
  get hasShots(): boolean {
    return this.shots !== null
  }
  get rafPending(): boolean {
    return this.rafId !== null
  }
  get waiting(): boolean {
    return this.waitTimer !== null
  }

  /** 浏览器可能在后台完全停止 RAF；两次可见性切换都重置基准，避免恢复后计入后台时间。 */
  visibilityChanged(): void {
    this.last = this.clock.now()
  }

  start(): Promise<IntroOutcome> {
    if (this.started) return this.done
    this.started = true
    try {
      this.release = this.port.acquireLock()
    } catch {
      this.release = null
    }
    this.last = this.clock.now()
    this.emitFrame()
    this.schedule()
    return this.done
  }

  /** 跳过：落到与完整播完相同的终态。地图未就绪时等其就绪（受超时保护）。 */
  skip(): void {
    if (this._status === 'done') return
    if (this._status === 'error') {
      this.finish('failed', false)
      return
    }
    if (this.port.readyState() === 'ready') {
      this.finish('skipped', true)
      return
    }
    this.skipRequested = true
    this._t = Math.min(this._t, this.gate)
    this.beginWait()
  }

  /** 取消：只清理，不写终态镜头（世界被替换 / 组件卸载）。 */
  cancel(): void {
    this.finish('cancelled', false)
  }

  /** 视口变化：中止并跳到（按新尺寸重算的）终态。 */
  resize(): void {
    if (this._status === 'done') return
    if (this._status === 'error') return
    this.skip()
  }

  /** error 状态下重试核心加载。 */
  retry(): void {
    if (this._status !== 'error') return
    this._error = ''
    if (!this.release) {
      try {
        this.release = this.port.acquireLock()
      } catch {
        this.release = null
      }
    }
    this.beginWait(true)
  }

  /** error 状态下放弃演出，直接返回地图。 */
  dismiss(): void {
    if (this._status === 'done') return
    this.finish('failed', false)
  }

  // ───────── 内部 ─────────

  private setStatus(s: IntroStatus, detail: { error?: string; outcome?: IntroOutcome } = {}): void {
    this._status = s
    try {
      this.opts.onStatus?.(s, detail)
    } catch {
      /* UI 回调异常不影响状态机与清理 */
    }
  }

  private schedule(): void {
    if (this.rafId === null && this._status === 'playing') this.rafId = this.clock.raf((n) => this.tick(n))
  }

  private tick(now: number): void {
    this.rafId = null
    if (this._status !== 'playing') return
    if (this.opts.isHidden?.()) {
      // 切后台：暂停，不把后台时间算进片长
      this.last = now
      this.schedule()
      return
    }
    const dt = Math.max(0, (now - this.last) / 1000)
    this.last = now
    const prev = this._t
    const next = Math.min(this.duration, prev + dt)
    if (!this.shots && next >= this.gate) {
      if (this.port.readyState() === 'ready') {
        if (!this.prepare()) return
      } else {
        this._t = Math.max(prev, Math.min(next, this.gate - 1e-3))
        this.emitFrame()
        this.beginWait()
        return
      }
    }
    for (const c of cuesBetween(prev, next, this.reduced)) {
      try {
        this.opts.onCue?.(c.kind)
      } catch {
        /* 音频失败不阻塞画面 */
      }
    }
    this._t = next
    this.emitFrame()
    if (next >= this.duration) {
      this.finish('completed', true)
      return
    }
    this.schedule()
  }

  /** 计算取景并构建入场层；取景失败进入 error。返回是否可继续。 */
  private prepare(): boolean {
    let shots: IntroShots | null = null
    try {
      shots = this.port.computeShots(this.cast)
    } catch {
      shots = null
    }
    if (!shots) {
      this.enterError('舆图取景失败')
      return false
    }
    this.shots = shots
    try {
      this.port.buildLayer(this.cast)
    } catch {
      // 可选效果失败：不阻塞入局，只是没有本方勾边 / 压暗
      try {
        this.port.destroyLayer()
      } catch {
        /* ignore */
      }
    }
    return true
  }

  private beginWait(isRetry = false): void {
    if (this.waitTimer !== null) return
    if (this.rafId !== null) {
      this.clock.caf(this.rafId)
      this.rafId = null
    }
    this.setStatus('waiting')
    const seq = ++this.waitSeq
    const timeoutMs = this.opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.waitTimer = this.clock.setTimeout(() => {
      if (seq !== this.waitSeq) return
      this.waitTimer = null
      this.waitSeq++
      this.enterError('舆图载入超时')
    }, timeoutMs)
    let p: Promise<MapReadyResult>
    try {
      p = Promise.resolve(isRetry ? this.port.retryLoad() : this.port.whenReady())
    } catch (e) {
      // 端口同步抛错同样进入错误恢复，不挂起
      p = Promise.reject(e)
    }
    p
      .catch((e: unknown): MapReadyResult => ({ ok: false, reason: String((e as Error)?.message ?? e) }))
      .then((r) => {
        if (seq !== this.waitSeq || this._status === 'done') return
        this.clearWait()
        if (!r.ok) {
          this.enterError(r.reason || '舆图载入失败')
          return
        }
        if (this.skipRequested) {
          this.finish('skipped', true)
          return
        }
        if (!this.prepare()) return
        this.setStatus('playing')
        this.last = this.clock.now()
        this.schedule()
      })
      .catch(() => {
        if (this._status !== 'done') this.enterError('舆图载入失败')
      })
  }

  private clearWait(): void {
    if (this.waitTimer !== null) this.clock.clearTimeout(this.waitTimer)
    this.waitTimer = null
    this.waitSeq++
  }

  private enterError(msg: string): void {
    this.clearWait()
    if (this.rafId !== null) {
      this.clock.caf(this.rafId)
      this.rafId = null
    }
    this._error = msg
    this.skipRequested = false
    // 不无限持有输入锁：错误面板期间锁释放，用户可重试或返回地图
    this.releaseLock()
    this.setStatus('error', { error: msg })
  }

  private releaseLock(): void {
    const r = this.release
    this.release = null
    try {
      r?.()
    } catch {
      /* 释放函数异常不影响清理 */
    }
  }

  private emitFrame(): void {
    const frame = computeFrame(this._t, this.reduced, this.cast.roster.length)
    try {
      this.opts.onFrame?.(this._t, frame)
    } catch {
      /* DOM 帧回调异常不阻断时间轴 */
    }
    if (this.shots) {
      const key = cameraKey(this._t, this.reduced)
      const shot = lerpShot(this.shots[key.a], this.shots[key.b], key.k)
      try {
        this.port.render(frame, shot)
      } catch {
        /* 渲染异常不阻断时间轴 */
      }
    }
  }

  private finish(outcome: IntroOutcome, applyFinal: boolean): void {
    if (this._status === 'done' || this._outcome !== null) return
    // 先占位 outcome：即便下面任一步异常，也不会重入，且 finally 一定 resolve
    this._outcome = outcome
    try {
      this.finishSteps(outcome, applyFinal)
    } catch {
      /* 任何清理异常都不能阻止锁释放与 promise 结束 */
    } finally {
      if (this.rafId !== null) {
        try {
          this.clock.caf(this.rafId)
        } catch {
          /* ignore */
        }
        this.rafId = null
      }
      this.releaseLock()
      this._status = 'done'
      this.resolveDone(outcome)
    }
  }

  private finishSteps(outcome: IntroOutcome, applyFinal: boolean): void {
    this.clearWait()
    if (this.rafId !== null) {
      this.clock.caf(this.rafId)
      this.rafId = null
    }
    let worldIntact = false
    try {
      worldIntact = this.port.worldToken() === this.startToken
    } catch {
      worldIntact = false
    }
    if (applyFinal && worldIntact && this.port.readyState() === 'ready') {
      try {
        // 终态按当前视口重算，resize 之后也落在正确取景
        const shots = this.port.computeShots(this.cast)
        if (shots) this.port.setFinalCamera(shots.final)
      } catch {
        /* 终态镜头失败不影响清理 */
      }
    }
    try {
      this.port.destroyLayer()
    } catch {
      /* ignore */
    }
    this.releaseLock()
    this.shots = null
    if (outcome === 'completed' || outcome === 'skipped') this._t = this.duration
    this.setStatus('done', { outcome })
  }
}
