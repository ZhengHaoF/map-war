/**
 * 开场程序化原创音效（自样片移植）：低鼓、纸声、落印。
 * 默认静音；只在用户手势（点击“开启音效”）中创建 / 恢复 AudioContext。
 * 每个音色的节点都登记在 voices 中，跳过 / 结束 / 卸载时全部停止并断开；音频失败不影响画面。
 */
import type { CueKind } from './introTimeline'

interface Voice {
  sources: AudioScheduledSourceNode[]
  nodes: AudioNode[]
}
type Reg = <T extends AudioNode>(node: T, isSource?: boolean) => T

export class IntroAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private failed = false
  muted = true
  readonly voices = new Set<Voice>()

  get state(): string {
    if (this.failed) return 'unavailable'
    if (!this.ctx) return 'locked'
    return this.ctx.state
  }

  /** 必须在用户手势回调中调用 */
  unlock(): void {
    if (this.failed) return
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) {
          this.failed = true
          return
        }
        const ctx = new AC()
        this.ctx = ctx
        this.master = ctx.createGain()
        this.master.gain.value = this.muted ? 0 : 0.9
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.value = -14
        comp.ratio.value = 4
        this.master.connect(comp)
        comp.connect(ctx.destination)
        const len = Math.floor(ctx.sampleRate * 2)
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
        const d = this.noise.getChannelData(0)
        let seed = 1337
        for (let i = 0; i < len; i++) {
          seed = (seed * 16807) % 2147483647
          d[i] = (seed / 2147483647) * 2 - 1
        }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
    } catch {
      this.failed = true
    }
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (m) this.stopAll()
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, now, 0.04)
    }
  }

  stopAll(): void {
    for (const v of this.voices) this.kill(v)
    this.voices.clear()
  }

  private kill(v: Voice): void {
    for (const s of v.sources) {
      try {
        s.onended = null
        s.stop()
      } catch {
        /* 已停止 */
      }
    }
    for (const n of v.nodes) {
      try {
        n.disconnect()
      } catch {
        /* 已断开 */
      }
    }
  }

  private voice(build: (ctx: AudioContext, t0: number, reg: Reg) => void): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    const v: Voice = { sources: [], nodes: [] }
    const ctx = this.ctx
    const t0 = ctx.currentTime + 0.01
    let remaining = 0
    const reg: Reg = (node, isSource = false) => {
      v.nodes.push(node)
      if (isSource) {
        const src = node as unknown as AudioScheduledSourceNode
        v.sources.push(src)
        remaining++
        src.onended = () => {
          remaining--
          if (remaining <= 0) {
            this.kill(v)
            this.voices.delete(v)
          }
        }
      }
      return node
    }
    try {
      build(ctx, t0, reg)
      this.voices.add(v)
    } catch {
      this.kill(v)
    }
  }

  private env(ctx: AudioContext, reg: Reg, t0: number, peak: number, attack: number, decay: number): GainNode {
    const g = reg(ctx.createGain())
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
    return g
  }

  private drum(
    ctx: AudioContext,
    t0: number,
    reg: Reg,
    { f0 = 72, f1 = 38, dur = 1.4, gain = 0.9, noise = 0.25 } = {},
  ): void {
    const osc = reg(ctx.createOscillator(), true)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, t0)
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6)
    const g = this.env(ctx, reg, t0, gain, 0.008, dur)
    osc.connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.1)
    if (noise > 0 && this.noise) {
      const src = reg(ctx.createBufferSource(), true)
      src.buffer = this.noise
      const lp = reg(ctx.createBiquadFilter())
      lp.type = 'lowpass'
      lp.frequency.value = 420
      const ng = this.env(ctx, reg, t0, noise, 0.004, 0.22)
      src.connect(lp).connect(ng).connect(this.master!)
      src.start(t0)
      src.stop(t0 + 0.3)
    }
  }

  private rustle(ctx: AudioContext, t0: number, reg: Reg, dur: number, gain: number): void {
    if (!this.noise) return
    const src = reg(ctx.createBufferSource(), true)
    src.buffer = this.noise
    src.loop = true
    const bp = reg(ctx.createBiquadFilter())
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(900, t0)
    bp.frequency.exponentialRampToValueAtTime(3200, t0 + dur * 0.55)
    bp.frequency.exponentialRampToValueAtTime(1400, t0 + dur)
    const g = reg(ctx.createGain())
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.25)
    const lfo = reg(ctx.createOscillator(), true)
    lfo.frequency.value = 17
    const lg = reg(ctx.createGain())
    lg.gain.value = gain * 0.45
    lfo.connect(lg).connect(g.gain)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(bp).connect(g).connect(this.master!)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
    lfo.start(t0)
    lfo.stop(t0 + dur + 0.05)
  }

  play(kind: CueKind): void {
    this.voice((ctx, t0, reg) => {
      switch (kind) {
        case 'drip': {
          const osc = reg(ctx.createOscillator(), true)
          osc.type = 'sine'
          osc.frequency.setValueAtTime(520, t0)
          osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.18)
          const g = this.env(ctx, reg, t0, 0.32, 0.005, 0.5)
          osc.connect(g).connect(this.master!)
          osc.start(t0)
          osc.stop(t0 + 0.6)
          this.drum(ctx, t0 + 0.04, reg, { f0: 58, f1: 34, dur: 2.2, gain: 0.55, noise: 0 })
          break
        }
        case 'drum':
          this.drum(ctx, t0, reg, { f0: 80, f1: 40, dur: 1.5, gain: 0.85 })
          break
        case 'drumSoft':
          this.drum(ctx, t0, reg, { f0: 70, f1: 42, dur: 1.1, gain: 0.5 })
          break
        case 'drumBig':
          this.drum(ctx, t0, reg, { f0: 66, f1: 31, dur: 2.6, gain: 1.0, noise: 0.35 })
          break
        case 'drumTail':
          this.drum(ctx, t0, reg, { f0: 52, f1: 30, dur: 2.4, gain: 0.45, noise: 0 })
          break
        case 'tap': {
          if (!this.noise) break
          const src = reg(ctx.createBufferSource(), true)
          src.buffer = this.noise
          const bp = reg(ctx.createBiquadFilter())
          bp.type = 'bandpass'
          bp.frequency.value = 1300 + Math.random() * 500
          bp.Q.value = 3
          const g = this.env(ctx, reg, t0, 0.32, 0.002, 0.09)
          src.connect(bp).connect(g).connect(this.master!)
          src.start(t0)
          src.stop(t0 + 0.14)
          break
        }
        case 'seal':
          this.drum(ctx, t0, reg, { f0: 140, f1: 70, dur: 0.35, gain: 0.5, noise: 0.4 })
          break
        case 'stamp': {
          this.drum(ctx, t0, reg, { f0: 96, f1: 28, dur: 2.8, gain: 1.0, noise: 0.7 })
          const osc = reg(ctx.createOscillator(), true)
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(190, t0)
          osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.25)
          const g = this.env(ctx, reg, t0, 0.35, 0.004, 0.35)
          osc.connect(g).connect(this.master!)
          osc.start(t0)
          osc.stop(t0 + 0.45)
          break
        }
        case 'unroll':
          this.rustle(ctx, t0, reg, 2.2, 0.22)
          break
        case 'unrollShort':
          this.rustle(ctx, t0, reg, 0.9, 0.14)
          break
        default:
          break
      }
    })
  }

  dispose(): void {
    this.stopAll()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    if (ctx) ctx.close().catch(() => {})
  }
}
