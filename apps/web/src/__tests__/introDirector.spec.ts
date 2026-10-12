import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Owner } from '@/data/owners'
import { useGameStore } from '@/stores/game'
import {
  IntroDirector,
  type IntroClock,
  type IntroMapPort,
  type MapReadyResult,
  type MapReadyState,
} from '@/utils/intro/introDirector'
import { buildIntroCast, type IntroShots, type Shot } from '@/utils/intro/introPlan'
import { FULL_DURATION, REDUCED_DURATION } from '@/utils/intro/introTimeline'

const SHOTS: IntroShots = {
  wide: { cx: 500, cy: 300, z: 1 },
  national: { cx: 500, cy: 300, z: 1.2 },
  drift: { cx: 520, cy: 310, z: 1.4 },
  faction: { cx: 400, cy: 350, z: 3 },
  final: { cx: 410, cy: 355, z: 2.8 },
}

function fakeClock() {
  let now = 0
  let id = 1
  const frames = new Map<number, (n: number) => void>()
  const timers = new Map<number, { at: number; cb: () => void }>()
  const clock: IntroClock = {
    raf: (cb) => {
      const i = id++
      frames.set(i, cb)
      return i
    },
    caf: (i) => void frames.delete(i),
    now: () => now,
    setTimeout: (cb, ms) => {
      const i = id++
      timers.set(i, { at: now + ms, cb })
      return i
    },
    clearTimeout: (i) => void timers.delete(i as number),
  }
  const advance = async (ms: number, step = 16): Promise<void> => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + step)
      for (const [i, t] of timers) {
        if (t.at <= now) {
          timers.delete(i)
          t.cb()
        }
      }
      const list = [...frames.values()]
      frames.clear()
      for (const cb of list) cb(now)
      await Promise.resolve()
    }
  }
  return { clock, advance, frames, timers, elapseWithoutFrames: (ms: number) => { now += ms } }
}

function fakePort(initial: MapReadyState = 'ready') {
  let state: MapReadyState = initial
  let token = 'w1'
  let locks = 0
  const waiters: ((r: MapReadyResult) => void)[] = []
  const calls = { render: [] as Shot[], final: [] as Shot[], build: 0, destroy: 0, retry: 0 }
  const port: IntroMapPort = {
    readyState: () => state,
    whenReady: () =>
      state === 'ready'
        ? Promise.resolve({ ok: true })
        : state === 'failed'
          ? Promise.resolve({ ok: false, reason: 'x' })
          : new Promise((r) => waiters.push(r)),
    retryLoad: vi.fn<() => Promise<MapReadyResult>>(async () => {
      calls.retry++
      state = 'ready'
      return { ok: true } as MapReadyResult
    }),
    computeShots: () => SHOTS,
    buildLayer: () => void calls.build++,
    render: (_f, s) => void calls.render.push(s),
    setFinalCamera: (s) => void calls.final.push(s),
    destroyLayer: () => void calls.destroy++,
    acquireLock: () => {
      locks++
      let done = false
      return () => {
        if (done) return
        done = true
        locks--
      }
    },
    worldToken: () => token,
  }
  return {
    port,
    calls,
    locks: () => locks,
    setToken: (t: string) => (token = t),
    settle: (r: MapReadyResult) => {
      state = r.ok ? 'ready' : 'failed'
      for (const w of waiters.splice(0)) w(r)
    },
  }
}

let cast: ReturnType<typeof buildIntroCast>
beforeEach(() => {
  const s = useGameStore()
  s.initWorld()
  cast = buildIntroCast({ faction: Owner.GXC, playerName: '李', cities: s.cities, activeFactions: s.activeFactions })
})

function make(opts: { reduced?: boolean; state?: MapReadyState; timeout?: number } = {}) {
  const c = fakeClock()
  const p = fakePort(opts.state ?? 'ready')
  const cues: string[] = []
  const statuses: string[] = []
  const d = new IntroDirector({
    port: p.port,
    cast,
    reduced: opts.reduced ?? false,
    clock: c.clock,
    readyTimeoutMs: opts.timeout ?? 15000,
    onCue: (k) => void cues.push(k),
    onStatus: (s) => void statuses.push(s),
  })
  return { d, c, p, cues, statuses }
}

const isDone = async (pr: Promise<unknown>): Promise<boolean> => {
  let done = false
  void pr.then(() => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

describe('IntroDirector', () => {
  it('full version runs 18 s, holds lock throughout, lands on final camera, cleans everything', async () => {
    const { d, c, p, cues } = make()
    const done = d.start()
    expect(p.locks()).toBe(1)
    await c.advance(17_000)
    expect(d.status).toBe('playing')
    expect(await isDone(done)).toBe(false)
    expect(p.locks()).toBe(1)
    await c.advance(1_100)
    expect(await done).toBe('completed')
    expect(d.t).toBe(FULL_DURATION)
    expect(p.calls.final.at(-1)).toEqual(SHOTS.final)
    expect(p.calls.build).toBe(1)
    expect(p.calls.destroy).toBe(1)
    expect(p.locks()).toBe(0)
    expect(d.rafPending).toBe(false)
    expect(d.waiting).toBe(false)
    expect(c.frames.size).toBe(0)
    expect(c.timers.size).toBe(0)
    expect(cues.length).toBeGreaterThan(3)
  })

  it('reduced motion: 3.6 s, camera only wide→final (no large interpolated moves)', async () => {
    const { d, c, p } = make({ reduced: true })
    const done = d.start()
    await c.advance(3_700)
    expect(await done).toBe('completed')
    expect(d.duration).toBe(REDUCED_DURATION)
    const distinct = new Set(p.calls.render.map((s) => JSON.stringify(s)))
    for (const s of distinct) expect([JSON.stringify(SHOTS.wide), JSON.stringify(SHOTS.final)]).toContain(s)
    expect(p.locks()).toBe(0)
  })

  it('skip at any time ends immediately with fresh final camera and releases lock', async () => {
    const { d, c, p } = make()
    const done = d.start()
    await c.advance(2_000)
    d.skip()
    expect(await done).toBe('skipped')
    expect(p.calls.final.at(-1)).toEqual(SHOTS.final)
    expect(p.locks()).toBe(0)
    expect(c.frames.size).toBe(0)
    d.skip()
    d.cancel()
    expect(d.outcome).toBe('skipped')
  })

  it('cancel does not write a final camera', async () => {
    const { d, c, p } = make()
    const done = d.start()
    await c.advance(9_000)
    const finals = p.calls.final.length
    d.cancel()
    expect(await done).toBe('cancelled')
    expect(p.calls.final.length).toBe(finals)
    expect(p.calls.destroy).toBe(1)
    expect(p.locks()).toBe(0)
  })

  it('world replaced (load / restart) during intro: no final camera is applied', async () => {
    const { d, c, p } = make()
    const done = d.start()
    await c.advance(8_000)
    p.setToken('w2')
    d.skip()
    expect(await done).toBe('skipped')
    expect(p.calls.final.length).toBe(0)
    expect(p.locks()).toBe(0)
  })

  it('waits at the map gate while map pending, then continues when ready', async () => {
    const { d, c, p } = make({ state: 'pending' })
    const done = d.start()
    await c.advance(8_000)
    expect(d.status).toBe('waiting')
    expect(d.t).toBeLessThan(5.6)
    expect(p.calls.build).toBe(0)
    expect(p.locks()).toBe(1)
    p.settle({ ok: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(d.status).toBe('playing')
    await c.advance(13_000)
    expect(await done).toBe('completed')
    expect(p.locks()).toBe(0)
  })

  it('skip while waiting: finishes as soon as map is ready', async () => {
    const { d, c, p } = make({ state: 'pending' })
    const done = d.start()
    await c.advance(1_000)
    d.skip()
    expect(await isDone(done)).toBe(false)
    p.settle({ ok: true })
    expect(await done).toBe('skipped')
    expect(p.calls.final.at(-1)).toEqual(SHOTS.final)
    expect(p.locks()).toBe(0)
  })

  it('ready failure → error releases lock; retry recovers; dismiss ends as failed', async () => {
    const { d, c, p } = make({ state: 'pending' })
    const done = d.start()
    await c.advance(6_000)
    p.settle({ ok: false, reason: 'boom' })
    await Promise.resolve()
    await Promise.resolve()
    expect(d.status).toBe('error')
    expect(p.locks()).toBe(0)
    expect(c.frames.size).toBe(0)
    d.retry()
    expect(p.locks()).toBe(1)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(p.calls.retry).toBe(1)
    expect(d.status).toBe('playing')
    d.skip()
    expect(await done).toBe('skipped')
    expect(p.locks()).toBe(0)
  })

  it('ready timeout → error (lock released); dismiss / Esc ends without final camera', async () => {
    const { d, c, p } = make({ state: 'pending', timeout: 3000 })
    const done = d.start()
    await c.advance(9_000)
    expect(d.status).toBe('error')
    expect(p.locks()).toBe(0)
    expect(c.timers.size).toBe(0)
    d.dismiss()
    expect(await done).toBe('failed')
    expect(p.calls.final.length).toBe(0)
  })

  it('retryLoad that throws synchronously goes back to error, never hangs', async () => {
    const { d, c, p } = make({ state: 'failed' })
    p.port.retryLoad = () => {
      throw new Error('sync')
    }
    const done = d.start()
    await c.advance(6_000)
    await Promise.resolve()
    expect(d.status).toBe('error')
    d.retry()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(d.status).toBe('error')
    expect(p.locks()).toBe(0)
    d.dismiss()
    expect(await done).toBe('failed')
  })

  it('throwing callbacks / port methods never leave done pending or the lock held', async () => {
    const c = fakeClock()
    const p = fakePort('ready')
    p.port.destroyLayer = () => {
      throw new Error('destroy')
    }
    p.port.setFinalCamera = () => {
      throw new Error('final')
    }
    p.port.render = () => {
      throw new Error('render')
    }
    const d = new IntroDirector({
      port: p.port,
      cast,
      reduced: false,
      clock: c.clock,
      onFrame: () => {
        throw new Error('frame')
      },
      onStatus: () => {
        throw new Error('status')
      },
      onCue: () => {
        throw new Error('cue')
      },
    })
    const done = d.start()
    await c.advance(7_000)
    d.skip()
    expect(await done).toBe('skipped')
    expect(p.locks()).toBe(0)
    expect(d.status).toBe('done')
    expect(c.frames.size).toBe(0)
  })

  it('resize during play skips to final computed for the new viewport', async () => {
    const { d, c, p } = make()
    const done = d.start()
    await c.advance(7_000)
    d.resize()
    expect(await done).toBe('skipped')
    expect(p.calls.final.at(-1)).toEqual(SHOTS.final)
  })

  it('intro never mutates the game world', async () => {
    const s = useGameStore()
    const before = JSON.stringify(s.getSnapshot())
    const log = s.eventLog.length
    const { d, c } = make()
    const done = d.start()
    await c.advance(18_500)
    await done
    expect(JSON.stringify(s.getSnapshot())).toBe(before)
    expect(s.eventLog.length).toBe(log)
  })

  it('excludes background time when the browser completely suspends RAF', async () => {
    const { d, c } = make()
    d.start()
    await c.advance(1000)
    d.visibilityChanged() // hidden
    c.elapseWithoutFrames(60_000)
    d.visibilityChanged() // visible again
    await c.advance(100)
    expect(d.t).toBeCloseTo(1.1)
    expect(d.status).toBe('playing')
    d.cancel()
    expect(await d.done).toBe('cancelled')
  })
})
