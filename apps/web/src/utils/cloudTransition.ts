/**
 * 云雾蒙太奇 —— 纯 PixiJS 渲染原语（与 Vue 解耦）
 *
 * 把云雾效果抽成独立函数，既能被 Vue 组件（调试按钮）调用，
 * 也能被游戏指令层 gameOrders.ts 调用（供 AI 触发「时间流逝蒙太奇」）。
 *
 * 调用方只需传入已 init 的 PixiJS Application：
 *   await playCloudTransition(app, { coverDuration: 1300 })
 *
 * 注意：云雾挂于 app.stage 顶层（屏幕坐标，不受相机平移/缩放影响），
 * 因此永远稳稳盖住整张地图视口。
 */
import { Container, Graphics, Sprite, Texture, BlurFilter } from 'pixi.js'
import type { Application } from 'pixi.js'

const TEX = 256
let cloudTexture: Texture | null = null
let activeContainer: Container | null = null
let activeRaf: number | null = null
let playing = false

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** 烘焙一朵蓬松白云纹理：多个柔和白色径向渐变圆叠加成不规则云形，实白 + 羽化边缘 */
function getCloudTexture(): Texture {
  if (cloudTexture) return cloudTexture
  const size = TEX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)

  const stamp = (cx: number, cy: number, rad: number, core: number, mid: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, `rgba(255,255,255,${core})`)
    g.addColorStop(0.5, `rgba(255,255,255,${mid})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }

  const c = size / 2
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + Math.random() * 0.6
    const dist = Math.random() * size * 0.24
    const rad = size * (0.16 + Math.random() * 0.12)
    stamp(c + Math.cos(ang) * dist, c + Math.sin(ang) * dist, rad, 1, 0.82)
  }
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2
    const dist = size * 0.28 + Math.random() * size * 0.14
    const rad = size * (0.08 + Math.random() * 0.07)
    stamp(c + Math.cos(ang) * dist, c + Math.sin(ang) * dist, rad, 0.9, 0.6)
  }
  stamp(c, c, size * 0.22, 1, 0.9)

  cloudTexture = Texture.from(canvas)
  return cloudTexture
}

interface Cloud {
  sprite: Sprite
  sx: number
  sy: number
  ex: number
  ey: number
  sScale: number
  eScale: number
  aT: number
  vx: number
  vy: number
  dx: number
  dy: number
  spin: number
}

const WHITE = 0xffffff
const WHITE_SOFT = 0xf2f2f2
const SHADE = 0xd2d2d2

export interface CloudOptions {
  coverDuration?: number
  holdDuration?: number
  revealDuration?: number
  /** 盖满时由外部插一段逻辑（如推进回合），用于「时间流逝蒙太奇」藏状态切换 */
  onMidpoint?: () => void | Promise<void>
}

/**
 * 播放一次完整云雾蒙太奇：四边汇聚盖满 → 停顿 → 退散揭开。
 * @param app  已 init 的 PixiJS Application
 * @param opts 时长覆盖 / 中段回调
 */
export async function playCloudTransition(
  app: Application,
  opts: CloudOptions = {},
): Promise<void> {
  if (playing || !app?.stage) return
  playing = true

  const W = app.screen.width
  const H = app.screen.height
  const cover = opts.coverDuration ?? 1300
  const hold = opts.holdDuration ?? 800
  const reveal = opts.revealDuration ?? 1300
  const total = cover + hold + reveal
  const minDim = Math.min(W, H)
  const maxDim = Math.max(W, H)

  const container = new Container()
  container.eventMode = 'none'
  app.stage.addChild(container)
  activeContainer = container
  document.body.classList.add('cloud-active')

  const base = new Graphics()
  base.rect(-W * 0.15, -H * 0.15, W * 1.3, H * 1.3)
  base.fill({ color: 0xf2f2f2, alpha: 1 })
  base.alpha = 0
  container.addChild(base)

  const tex = getCloudTexture()
  const clouds: Cloud[] = []

  const add = (
    ax: number,
    ay: number,
    fx: number,
    fy: number,
    diam: number,
    tint: number,
    aT: number,
    vx: number,
    vy: number,
  ) => {
    const sp = new Sprite(tex)
    sp.anchor.set(0.5)
    sp.tint = tint
    const eScale = diam / TEX
    const sScale = eScale * 0.5
    const ex = ax * W
    const ey = ay * H
    const sx = ex + fx * W
    const sy = ey + fy * H
    sp.x = sx
    sp.y = sy
    sp.scale.set(sScale)
    sp.alpha = 0
    sp.rotation = Math.random() * Math.PI * 2
    container.addChild(sp)
    clouds.push({ sprite: sp, sx, sy, ex, ey, sScale, eScale, aT, vx, vy, dx: 0, dy: 0, spin: (Math.random() - 0.5) * 0.00008 })
  }

  add(0.5, 0.5, 0, 0, maxDim * 1.4, WHITE, 0.85, 0.016, 0.006)
  add(0.5, 0.5, 0, 0, maxDim * 1.55, WHITE_SOFT, 0.8, -0.013, 0.008)

  add(0.12, 0.26, -1.5, 0, minDim * 1.7, WHITE, 0.85, 0.026, 0.005)
  add(0.12, 0.74, -1.5, 0, minDim * 1.9, WHITE, 0.85, 0.023, -0.006)
  add(0.88, 0.28, 1.5, 0, minDim * 1.8, WHITE, 0.85, -0.026, 0.005)
  add(0.88, 0.72, 1.5, 0, minDim * 1.6, WHITE, 0.85, -0.023, -0.005)
  add(0.26, 0.1, 0, -1.5, minDim * 1.7, WHITE, 0.85, 0.006, 0.026)
  add(0.74, 0.1, 0, -1.5, minDim * 1.9, WHITE, 0.85, -0.005, 0.023)
  add(0.28, 0.9, 0, 1.5, minDim * 1.8, WHITE, 0.85, 0.005, -0.026)
  add(0.72, 0.9, 0, 1.5, minDim * 1.6, WHITE, 0.85, -0.006, -0.023)

  // 四角云团：从对角外滚入，补满边角（避免露出地图）
  add(0.02, 0.02, -1.4, -1.4, minDim * 1.5, WHITE, 0.85, 0.02, 0.02)
  add(0.98, 0.02, 1.4, -1.4, minDim * 1.5, WHITE, 0.85, -0.02, 0.02)
  add(0.02, 0.98, -1.4, 1.4, minDim * 1.5, WHITE, 0.85, 0.02, -0.02)
  add(0.98, 0.98, 1.4, 1.4, minDim * 1.5, WHITE, 0.85, -0.02, -0.02)

  for (let i = 0; i < 10; i++) {
    const ax = 0.2 + Math.random() * 0.6
    const ay = 0.2 + Math.random() * 0.6
    const ang = Math.random() * Math.PI * 2
    add(
      ax,
      ay,
      Math.cos(ang) * 0.4,
      Math.sin(ang) * 0.4,
      minDim * (0.7 + Math.random() * 0.5),
      Math.random() < 0.3 ? SHADE : WHITE_SOFT,
      0.6 + Math.random() * 0.2,
      (Math.random() - 0.5) * 0.03,
      (Math.random() - 0.5) * 0.02,
    )
  }

  for (let i = 0; i < 4; i++) {
    add(0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4, 0, 0, minDim * (0.5 + Math.random() * 0.3), WHITE, 0.5, 0.012, 0.004)
  }

  try {
    container.filters = [new BlurFilter({ strength: 2, quality: 3, padding: 40 })]
  } catch {
    /* 降级 */
  }

  const baseTarget = 1
  let midpointFired = false

  await new Promise<void>((resolve) => {
    const start = performance.now()
    let last = start
    const step = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      const t = now - start
      let p: number
      if (t < cover) p = easeInOut(t / cover)
      else if (t < cover + hold) p = 1
      else if (t < total) p = 1 - easeInOut((t - cover - hold) / reveal)
      else p = 0

      base.alpha = baseTarget * p

      for (const c of clouds) {
        c.dx += c.vx * dt
        c.dy += c.vy * dt
        c.sprite.x = lerp(c.sx, c.ex, p) + c.dx
        c.sprite.y = lerp(c.sy, c.ey, p) + c.dy
        c.sprite.scale.set(lerp(c.sScale, c.eScale, p))
        c.sprite.alpha = c.aT * p
        c.sprite.rotation += c.spin * dt
      }

      // 盖满瞬间触发中段回调（时间流逝蒙太奇在此藏状态切换）
      if (!midpointFired && opts.onMidpoint && t >= cover && t < cover + hold) {
        midpointFired = true
        void Promise.resolve(opts.onMidpoint()).catch(() => {})
      }

      if (t < total) {
        activeRaf = requestAnimationFrame(step)
      } else {
        activeRaf = null
        document.body.classList.remove('cloud-active')
        resolve()
      }
    }
    activeRaf = requestAnimationFrame(step)
  })

  container.filters = []
  try {
    app.stage.removeChild(container)
    container.destroy({ children: true })
  } catch {
    /* 容器可能已被外部销毁 */
  }
  activeContainer = null
  playing = false
}

/** 紧急清理（组件卸载 / 场景销毁时调用） */
export function disposeCloudTransition(): void {
  document.body.classList.remove('cloud-active')
  if (activeRaf) cancelAnimationFrame(activeRaf)
  if (activeContainer) {
    try {
      activeContainer.parent?.removeChild(activeContainer)
    } catch {
      /* noop */
    }
    try {
      activeContainer.destroy({ children: true })
    } catch {
      /* noop */
    }
  }
  activeContainer = null
  activeRaf = null
  playing = false
}
