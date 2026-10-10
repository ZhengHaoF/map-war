import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeCloudTransition, playCloudTransition } from '@/utils/cloudTransition'

vi.mock('pixi.js', () => {
  class Container {
    addChild = vi.fn<() => void>()
    removeChild = vi.fn<() => void>()
    destroy = vi.fn<() => void>()
  }
  class Graphics {
    rect() { return this }
    fill() { return this }
  }
  class Sprite {
    anchor = { set: vi.fn<() => void>() }
    scale = { set: vi.fn<() => void>() }
    rotation = 0
  }
  return { Container, Graphics, Sprite, Texture: { from: vi.fn<() => void>() }, BlurFilter: class {} }
})

let frames: FrameRequestCallback[]
beforeEach(() => {
  frames = []
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn<() => void>())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn<() => void>(), createRadialGradient: () => ({ addColorStop: vi.fn<() => void>() }),
    beginPath: vi.fn<() => void>(), arc: vi.fn<() => void>(), fill: vi.fn<() => void>(),
  } as never)
})
afterEach(() => {
  disposeCloudTransition()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('cloud transition state callback', () => {
  it.each([2200, 4000])('fires midpoint once even when a frame jumps to %i ms', async time => {
    const midpoint = vi.fn<() => void>()
    const app = { screen: { width: 800, height: 600 }, stage: { addChild: vi.fn<() => void>(), removeChild: vi.fn<() => void>() } }
    const animation = playCloudTransition(app as never, { onMidpoint: midpoint })
    frames.shift()!(time)
    if (frames.length) frames.shift()!(4000)
    await animation
    expect(midpoint).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains('cloud-active')).toBe(false)
  })
  it('fires once with ordinary cover, hold and reveal frames', async () => {
    const midpoint = vi.fn<() => void>()
    const app = { screen: { width: 800, height: 600 }, stage: { addChild: vi.fn<() => void>(), removeChild: vi.fn<() => void>() } }
    const animation = playCloudTransition(app as never, { onMidpoint: midpoint })
    for (const time of [500, 1300, 1500, 2200, 4000]) frames.shift()!(time)
    await animation
    expect(midpoint).toHaveBeenCalledTimes(1)
  })
})
