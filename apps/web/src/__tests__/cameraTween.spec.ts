import { describe, expect, it } from 'vitest'
import { createCameraTweener, type CameraState } from '@/utils/cameraTween'

function rig(reduced = false) {
  let cam: CameraState = { scale: 1, x: 0, y: 0 }
  let now = 0
  let nextId = 1
  const frames = new Map<number, (n: number) => void>()
  const tw = createCameraTweener({
    get: () => ({ ...cam }),
    set: (s) => {
      cam = { ...s }
    },
    reducedMotion: () => reduced,
    raf: (cb) => {
      const id = nextId++
      frames.set(id, cb)
      return id
    },
    caf: (id) => {
      frames.delete(id)
    },
    now: () => now,
  })
  const advance = (ms: number): void => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 16)
      const list = [...frames.entries()]
      frames.clear()
      for (const [, cb] of list) cb(now)
    }
  }
  return { tw, advance, cam: () => cam, pendingFrames: () => frames.size }
}

const settled = async (p: Promise<void>): Promise<boolean> => {
  let done = false
  void p.then(() => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

describe('camera tweener (animateCameraTo backend)', () => {
  it('reaches target and resolves after duration', async () => {
    const r = rig()
    const p = r.tw.tweenTo({ scale: 2, x: 100, y: 50 }, 500)
    expect(r.tw.active).toBe(true)
    r.advance(520)
    expect(await settled(p)).toBe(true)
    expect(r.cam()).toEqual({ scale: 2, x: 100, y: 50 })
    expect(r.tw.active).toBe(false)
    expect(r.pendingFrames()).toBe(0)
  })

  it('a superseded tween promise resolves immediately (old bug: hung forever)', async () => {
    const r = rig()
    const first = r.tw.tweenTo({ scale: 3, x: 10, y: 10 }, 1000)
    r.advance(100)
    const second = r.tw.tweenTo({ scale: 1, x: 0, y: 0 }, 300)
    expect(await settled(first)).toBe(true)
    expect(await settled(second)).toBe(false)
    r.advance(400)
    expect(await settled(second)).toBe(true)
    expect(r.cam()).toEqual({ scale: 1, x: 0, y: 0 })
    expect(r.pendingFrames()).toBe(0)
  })

  it('cancel() resolves the pending promise, stops RAF and leaves camera where it is', async () => {
    const r = rig()
    const p = r.tw.tweenTo({ scale: 4, x: 400, y: 0 }, 1000)
    r.advance(200)
    const mid = r.cam()
    r.tw.cancel()
    expect(await settled(p)).toBe(true)
    expect(r.pendingFrames()).toBe(0)
    r.advance(1000)
    expect(r.cam()).toEqual(mid)
    expect(r.tw.active).toBe(false)
  })

  it('abort signal resolves; pre-aborted signal never moves the camera', async () => {
    const r = rig()
    const ac = new AbortController()
    const p = r.tw.tweenTo({ scale: 4, x: 400, y: 0 }, 1000, { signal: ac.signal })
    r.advance(100)
    ac.abort()
    expect(await settled(p)).toBe(true)
    expect(r.tw.active).toBe(false)
    const before = r.cam()
    const pre = new AbortController()
    pre.abort()
    const q = r.tw.tweenTo({ scale: 9, x: 9, y: 9 }, 500, { signal: pre.signal })
    expect(await settled(q)).toBe(true)
    expect(r.cam()).toEqual(before)
  })

  it('reduced motion and zero duration jump directly without RAF', async () => {
    const r = rig(true)
    const p = r.tw.tweenTo({ scale: 2, x: 5, y: 6 }, 800)
    expect(await settled(p)).toBe(true)
    expect(r.cam()).toEqual({ scale: 2, x: 5, y: 6 })
    expect(r.pendingFrames()).toBe(0)
    const r2 = rig(false)
    const q = r2.tw.tweenTo({ scale: 3, x: 1, y: 1 }, 0)
    expect(await settled(q)).toBe(true)
    expect(r2.cam()).toEqual({ scale: 3, x: 1, y: 1 })
  })

  it('custom easing is honoured', () => {
    const r = rig()
    void r.tw.tweenTo({ scale: 1, x: 100, y: 0 }, 160, { ease: (t) => t })
    r.advance(80)
    expect(r.cam().x).toBeCloseTo(50, 0)
  })
})
