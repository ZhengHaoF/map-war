import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { resolveLocationXY, resolveLocation, geoToScreen } from './locationResolver'
import type { Point } from './locationResolver'

// ─── 贝塞尔曲线 ───

function bezier(t: number, p0: Point, p1: Point, p2: Point): Point {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

// ─── 绘制辅助 ───

function drawArrow(gfx: Graphics, x: number, y: number, angle: number, color = 0xffcc00): void {
  const size = 8
  gfx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size)
  gfx.lineTo(x + Math.cos(angle + 2.5) * size * 0.7, y + Math.sin(angle + 2.5) * size * 0.7)
  gfx.lineTo(x + Math.cos(angle - 2.5) * size * 0.7, y + Math.sin(angle - 2.5) * size * 0.7)
  gfx.closePath()
  gfx.fill({ color, alpha: 1 })
}

/**
 * 在地图上描出某个 GeoJSON Feature 的轮廓（高亮用）
 * @param fillAlpha 填充透明度（默认 0.4）
 * @param lineWidth 轮廓线宽（默认 0.5）
 * @param strokeAlpha 描边透明度（默认 1）
 */
function drawFeatureOutline(
  gfx: Graphics,
  feature: GeoJSON.Feature | null,
  color: number,
  fillAlpha = 0.4,
  lineWidth = 0.5,
  strokeAlpha = 1,
): void {
  if (!feature?.geometry) return
  const { geometry } = feature
  const polygons: GeoJSON.Position[][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as GeoJSON.Position[][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as GeoJSON.Position[][][])
        : []

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue
      const first = geoToScreen(ring[0][0], ring[0][1])
      gfx.moveTo(first.x, first.y)
      for (let i = 1; i < ring.length; i++) {
        const p = geoToScreen(ring[i][0], ring[i][1])
        gfx.lineTo(p.x, p.y)
      }
      gfx.closePath()
    }
    gfx.fill({ color, alpha: fillAlpha })
    gfx.stroke({ width: lineWidth, color, alpha: strokeAlpha })
  }
}

/**
 * 弹出文字（在目的地上方飘出）
 */
function showPopupText(
  container: Container,
  to: Point,
  text: string | undefined,
  color = 0xffffff,
): void {
  if (!text) return

  const style = new TextStyle({
    fontSize: 18,
    fontWeight: 'bold',
    fill: color,
    stroke: { color: 0x000000, width: 3 },
    dropShadow: { color: 0x000000, blur: 4, distance: 2 },
  })

  const textObj = new Text({ text, style })
  textObj.anchor.set(0.5)
  // 反向缩放：弹字画在 worldContainer 内会随相机放大，这里抵消保持屏幕恒定大小
  if (container.scale.x !== 1) textObj.scale.set(1 / container.scale.x)
  textObj.x = to.x
  textObj.y = to.y - 30
  container.addChild(textObj)

  const startTime = performance.now()
  const duration = 1200

  function animateText(now: number): void {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1)

    textObj.y = to.y - 30 - 40 * progress
    textObj.alpha = 1 - progress

    if (progress < 1) {
      requestAnimationFrame(animateText)
    } else {
      container.removeChild(textObj)
      textObj.destroy()
    }
  }
  requestAnimationFrame(animateText)
}

// ─── 类型定义 ───

export interface ArcAnimationOptions {
  /** 起点地点 id（城市 gb / 国家 iso_a3） */
  fromId: string
  /** 终点地点 id */
  toId: string
  /** 动画绘制的父容器 */
  container: Container
  /** 动画模式 */
  mode?: 'dots' | 'orb'
  /** 到达后是否爆炸 */
  explosion?: boolean
  /** 爆炸冲击波层数 */
  shockwaves?: number
  /** 到达后弹出的文字 */
  text?: string
  /** 弹出文字颜色 */
  textColor?: number
  /** 动画颜色 */
  color?: number
  /** 小箭头数量（dots 模式） */
  dots?: number
  /** 箭头间距（dots 模式） */
  spacing?: number
  /** 飞行时长（毫秒） */
  duration?: number
  /** 爆炸时长（毫秒） */
  explosionDuration?: number
}

export interface ScoutAnimationOptions {
  /** 起点地点 id */
  fromId: string
  /** 动画绘制的父容器 */
  container: Container
  /** 动画颜色 */
  color?: number
  /** 圆环数量 */
  rings?: number
  /** 动画时长（毫秒） */
  duration?: number
  /** 弹出文字 */
  text?: string
}

export interface BattleAnimationOptions {
  /** 起点地点 id */
  fromId: string
  /** 终点地点 id */
  toId: string
  /** 动画绘制的父容器 */
  container: Container
  /** 出发方颜色 */
  colorA?: number
  /** 目标方颜色 */
  colorB?: number
  /** A 方小球数量 */
  dotsA?: number
  /** B 方小球数量 */
  dotsB?: number
  /** 小球间距 */
  spacing?: number
  /** 每帧移动速度 */
  speed?: number
  /** 战斗弹字文案（可选；默认由调用方计算“XX 与 XX 交战”，AI 可覆盖） */
  text?: string
  /** 弹字颜色（默认朱红 0xff4444） */
  textColor?: number
}

export interface CaptureAnimationOptions {
  /** 目标地点 id（城市 gb） */
  targetId: string
  /** 动画绘制的父容器 */
  container: Container
  /** 动画颜色（新城主配色） */
  color?: number
  /** 动画时长（毫秒） */
  duration?: number
  /** 弹出文字 */
  text?: string
}

export interface BattleHandle {
  stop: () => void
  graphics: Graphics | null
}

// ─── 动画函数 ───

/**
 * 播放弧线动画（通用）
 *
 * 模式：
 * - mode='dots'  : 多箭头沿弧线移动（适合派兵、行军）
 * - mode='orb'   : 光球沿弧线移动（适合宣战、施法）
 */
export async function playArcAnimation({
  fromId,
  toId,
  container,
  mode = 'dots',
  explosion = false,
  shockwaves = 3,
  text,
  textColor = 0xffffff,
  color = 0xffcc00,
  dots = 5,
  spacing = 0.08,
  duration = 2000,
  explosionDuration = 800,
}: ArcAnimationOptions): Promise<void> {
  // 解析起点/终点坐标（按 id 在地点注册表中查）
  const from = resolveLocationXY(fromId)
  const to = resolveLocationXY(toId)
  if (!from || !to) {
    console.warn('[playArcAnimation] 缺少有效的 fromId/toId，无法解析坐标')
    return
  }

  // 内部高亮：创建独立 Graphics，描出出发地/目的地轮廓
  const hlGfx = new Graphics()
  container.addChild(hlGfx)
  const fFrom = resolveLocation(fromId)
  const fTo = resolveLocation(toId)
  drawFeatureOutline(hlGfx, fFrom, color)
  drawFeatureOutline(hlGfx, fTo, color)

  // 贝塞尔控制点（中点偏上，形成弧线）
  const p0 = from
  const p2 = to
  const p1: Point = {
    x: (p0.x + p2.x) / 2,
    y: Math.min(p0.y, p2.y) - Math.abs(p2.x - p0.x) * 0.3,
  }

  const animGfx = new Graphics()
  container.addChild(animGfx)

  // 阶段一：飞行
  const totalProgress = mode === 'dots' ? 1 + (dots - 1) * spacing : 1
  const startTime = performance.now()

  await new Promise<void>((resolve) => {
    function animate(now: number): void {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, totalProgress)

      animGfx.clear()

      // 画路径虚线
      const segments = 40
      for (let i = 0; i < segments; i++) {
        if (i % 2 === 0) {
          const t1 = i / segments
          const t2 = (i + 1) / segments
          const a = bezier(t1, p0, p1, p2)
          const b = bezier(t2, p0, p1, p2)
          animGfx.moveTo(a.x, a.y)
          animGfx.lineTo(b.x, b.y)
          animGfx.stroke({ width: 2, color, alpha: 0.3 })
        }
      }

      if (mode === 'dots') {
        // 箭头模式
        for (let i = 0; i < dots; i++) {
          const t = progress - i * spacing
          if (t < 0 || t > 1) continue
          const pos = bezier(t, p0, p1, p2)
          const next = bezier(Math.min(t + 0.01, 1), p0, p1, p2)
          const angle = Math.atan2(next.y - pos.y, next.x - pos.x)
          drawArrow(animGfx, pos.x, pos.y, angle, color)
        }
      } else {
        // 光球模式
        const pos = bezier(Math.min(progress, 1), p0, p1, p2)
        const ballRadius = 10

        // 外发光
        animGfx.circle(pos.x, pos.y, ballRadius * 2.5)
        animGfx.fill({ color, alpha: 0.15 })

        // 中层光晕
        animGfx.circle(pos.x, pos.y, ballRadius * 1.5)
        animGfx.fill({ color, alpha: 0.3 })

        // 核心
        animGfx.circle(pos.x, pos.y, ballRadius)
        animGfx.fill({ color, alpha: 0.9 })

        // 高光
        animGfx.circle(pos.x - 2, pos.y - 2, ballRadius * 0.4)
        animGfx.fill({ color: 0xffffff, alpha: 0.7 })
      }

      if (progress < totalProgress) {
        requestAnimationFrame(animate)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(animate)
  })

  // 阶段二：爆炸（可选）
  if (explosion) {
    const explosionStart = performance.now()
    // TS 在异步闭包中无法窄化 null，这里用非空断言（前面已 garud）
    const tx = to!.x
    const ty = to!.y

    await new Promise<void>((resolve) => {
      function animateExplosion(now: number): void {
        const elapsed = now - explosionStart
        const progress = Math.min(elapsed / explosionDuration, 1)

        animGfx.clear()

        // 冲击波
        for (let i = 0; i < shockwaves; i++) {
          const waveProgress = Math.max(0, progress - i * 0.12)
          if (waveProgress <= 0) continue

          const maxRadius = 60 + i * 15
          const radius = maxRadius * waveProgress
          const alpha = (1 - waveProgress) * 0.5

          animGfx.circle(tx, ty, radius)
          animGfx.stroke({ width: 3 - i * 0.8, color, alpha })
        }

        // 中心光球
        const coreProgress = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7
        const coreRadius = 15 * coreProgress
        const coreAlpha = coreProgress * 0.8

        if (coreRadius > 0) {
          animGfx.circle(tx, ty, coreRadius)
          animGfx.fill({ color, alpha: coreAlpha })

          animGfx.circle(tx, ty, coreRadius * 0.5)
          animGfx.fill({ color: 0xffffff, alpha: coreAlpha * 0.5 })
        }

        if (progress < 1) {
          requestAnimationFrame(animateExplosion)
        } else {
          setTimeout(() => resolve(), 200)
        }
      }
      requestAnimationFrame(animateExplosion)
    })
  }

  // 弹出文字
  showPopupText(container, to, text, textColor)

  // 清理
  container.removeChild(animGfx)
  animGfx.destroy()
  container.removeChild(hlGfx)
  hlGfx.destroy()

  if (text) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * 播放探察动画 - 雷达扫描式扩散
 * 以 from 为圆心的「侦察雷达」：旋转扫描扇区（拖尾余晖）+ 向外扩散的同心波环 +
 * 扫描线掠过时随机闪现的「接触点」光斑 + 中心信标脉冲。比纯同心环更有探察语义。
 */
export async function playScoutAnimation({
  fromId,
  container,
  color = 0x22c55e,
  rings = 3,
  duration = 1800,
  text,
}: ScoutAnimationOptions): Promise<void> {
  const from = resolveLocationXY(fromId)
  if (!from) {
    console.warn('[playScoutAnimation] 缺少有效的 fromId，无法解析坐标')
    return
  }
  const fx = from.x
  const fy = from.y

  const animGfx = new Graphics()
  container.addChild(animGfx)

  const TWO_PI = Math.PI * 2
  const maxRadius = 90
  const sweepTurns = 1.5 // 扫描线整段旋转圈数
  const trail = Math.PI / 3 // 扫描扇区拖尾宽度（60°）

  // 随机接触点：扫描线掠过其角度时点亮并淡出，营造"发现目标"的雷达感
  const blips = Array.from({ length: 5 }, () => ({
    angle: Math.random() * TWO_PI,
    dist: (0.3 + Math.random() * 0.6) * maxRadius,
    life: 0, // 0=未点亮，>0=剩余寿命(1→0)
  }))

  const startTime = performance.now()

  await new Promise<void>((resolve) => {
    function animate(now: number): void {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)

      animGfx.clear()

      const lead = TWO_PI * sweepTurns * progress // 扫描前缘当前角度

      // 1) 扩散同心波环
      for (let i = 0; i < rings; i++) {
        const ringProgress = Math.max(0, progress - i * 0.15)
        if (ringProgress <= 0) continue
        const radius = maxRadius * ringProgress
        const alpha = (1 - ringProgress) * 0.5
        animGfx.circle(fx, fy, radius)
        animGfx.stroke({ width: 2, color, alpha })
      }

      // 2) 扫描扇区拖尾余晖（lead-trail → lead 的扇形填充）
      animGfx.moveTo(fx, fy)
      animGfx.arc(fx, fy, maxRadius, lead - trail, lead)
      animGfx.lineTo(fx, fy)
      animGfx.fill({ color, alpha: 0.12 })

      // 3) 扫描前缘亮线
      animGfx.moveTo(fx, fy)
      animGfx.lineTo(fx + Math.cos(lead) * maxRadius, fy + Math.sin(lead) * maxRadius)
      animGfx.stroke({ width: 2.5, color, alpha: 0.9 })

      // 4) 接触点：扫描线刚掠过其角度时点亮，随后淡出
      for (const b of blips) {
        let diff = (lead - b.angle) % TWO_PI
        if (diff < 0) diff += TWO_PI
        if (b.life <= 0 && diff < 0.15) b.life = 1 // 被扫到
        if (b.life > 0) {
          const bx = fx + Math.cos(b.angle) * b.dist
          const by = fy + Math.sin(b.angle) * b.dist
          animGfx.circle(bx, by, 3 + 3 * b.life)
          animGfx.fill({ color: 0xffffff, alpha: 0.9 * b.life })
          animGfx.circle(bx, by, 7 * b.life)
          animGfx.stroke({ width: 1.5, color, alpha: 0.6 * b.life })
          b.life -= 0.04
          if (b.life < 0) b.life = 0
        }
      }

      // 5) 中心信标（随进度脉冲一次）
      animGfx.circle(fx, fy, 4)
      animGfx.fill({ color, alpha: 0.9 })
      animGfx.circle(fx, fy, 9 * (0.6 + 0.4 * Math.sin(progress * Math.PI)))
      animGfx.stroke({ width: 1.5, color, alpha: 0.5 })

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setTimeout(() => resolve(), 300)
      }
    }
    requestAnimationFrame(animate)
  })

  // 弹出文字
  showPopupText(container, from, text, color)

  // 清理
  container.removeChild(animGfx)
  animGfx.destroy()

  if (text) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * 开始战斗动画 - 双向交火（持续动画，需手动停止）
 * 贝塞尔曲线路径，两种颜色小球相向移动
 */
export function startBattleAnimation({
  fromId,
  toId,
  container,
  colorA = 0x3b82f6,
  colorB = 0xef4444,
  dotsA = 3,
  dotsB = 3,
  spacing = 0.15,
  speed = 0.004,
  text,
  textColor,
}: BattleAnimationOptions): BattleHandle {
  const from = resolveLocationXY(fromId)
  const to = resolveLocationXY(toId)
  if (!from || !to) {
    console.warn('[startBattleAnimation] 缺少有效的 fromId/toId，无法解析坐标')
    return { stop(): void {}, graphics: null }
  }

  // 内部高亮（仅描边，不填充，避免大面积高亮刺眼）
  const hlGfx = new Graphics()
  container.addChild(hlGfx)
  drawFeatureOutline(hlGfx, resolveLocation(fromId), 0xef4444, 0, 1, 1)
  drawFeatureOutline(hlGfx, resolveLocation(toId), 0xef4444, 0, 1, 1)

  // 贝塞尔控制点
  const p0 = from
  const p2 = to
  const p1: Point = {
    x: (p0.x + p2.x) / 2,
    y: Math.min(p0.y, p2.y) - Math.abs(p2.x - p0.x) * 0.3,
  }

  // 战斗弹字：在光束中点浮出（AI 可覆盖文案），与镜头平行 —— 方案 A：光束亮起即弹
  showPopupText(container, bezier(0.5, p0, p1, p2), text, textColor ?? 0xff4444)

  const animGfx = new Graphics()
  container.addChild(animGfx)

  let progressA = 0 // A方小球进度（0→1）
  let progressB = 0 // B方小球进度（0→1，反向）
  let running = true
  let rafId: number | null = null

  function animate(): void {
    if (!running) return

    animGfx.clear()

    // 画路径虚线
    const segments = 40
    for (let i = 0; i < segments; i++) {
      if (i % 2 === 0) {
        const t1 = i / segments
        const t2 = (i + 1) / segments
        const a = bezier(t1, p0, p1, p2)
        const b = bezier(t2, p0, p1, p2)
        animGfx.moveTo(a.x, a.y)
        animGfx.lineTo(b.x, b.y)
        animGfx.stroke({ width: 2, color: 0xffffff, alpha: 0.15 })
      }
    }

    // A方小球
    for (let i = 0; i < dotsA; i++) {
      const t = progressA - i * spacing
      if (t < 0 || t > 1) continue
      const pos = bezier(t, p0, p1, p2)
      const next = bezier(Math.min(t + 0.01, 1), p0, p1, p2)
      const angle = Math.atan2(next.y - pos.y, next.x - pos.x)
      drawArrow(animGfx, pos.x, pos.y, angle, colorA)
    }

    // B方小球（反向）
    for (let i = 0; i < dotsB; i++) {
      const t = progressB - i * spacing
      if (t < 0 || t > 1) continue
      const pos = bezier(1 - t, p0, p1, p2)
      const next = bezier(Math.max(0, 1 - t - 0.01), p0, p1, p2)
      const angle = Math.atan2(next.y - pos.y, next.x - pos.x)
      drawArrow(animGfx, pos.x, pos.y, angle, colorB)
    }

    // 更新进度
    progressA += speed
    progressB += speed

    const totalA = 1 + (dotsA - 1) * spacing
    const totalB = 1 + (dotsB - 1) * spacing
    if (progressA > totalA + 0.3) progressA = 0
    if (progressB > totalB + 0.3) progressB = 0

    rafId = requestAnimationFrame(animate)
  }

  rafId = requestAnimationFrame(animate)

  return {
    stop(): void {
      running = false
      if (rafId) cancelAnimationFrame(rafId)
      container.removeChild(animGfx)
      animGfx.destroy()
      container.removeChild(hlGfx)
      hlGfx.destroy()
    },
    graphics: animGfx,
  }
}

/**
 * 播放占领动画 - 城池点亮（脉冲填充）+ 双层冲击波扩散 + 粒子爆发 + 弹字
 * 以新城主配色演出"插旗接管"语义：目标城先被点亮，再向外扩散冲击波与碎屑。
 */
export async function playCaptureAnimation({
  targetId,
  container,
  color = 0xffcc00,
  duration = 1700,
  text,
}: CaptureAnimationOptions): Promise<void> {
  const target = resolveLocationXY(targetId)
  if (!target) {
    console.warn('[playCaptureAnimation] 缺少有效的 targetId，无法解析坐标')
    return
  }
  const tx = target.x
  const ty = target.y
  const feature = resolveLocation(targetId)

  const gfx = new Graphics()
  container.addChild(gfx)

  const startTime = performance.now()
  const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

  await new Promise<void>((resolve) => {
    function animate(now: number): void {
      const elapsed = now - startTime
      const t = Math.min(elapsed / duration, 1)

      gfx.clear()

      // 1) 城池轮廓脉冲点亮（新区主配色）：先亮一下、再回落到稳态淡填充
      const flash = t < 0.35 ? t / 0.35 : 1 - ((t - 0.35) / 0.65) * 0.45
      drawFeatureOutline(gfx, feature, color, 0.1 + 0.45 * flash, 1.5 + 3 * flash)

      // 2) 双层冲击波（easeOut 扩散，先后错开）
      const waves = [
        { delay: 0.0, maxR: 72 },
        { delay: 0.18, maxR: 100 },
      ]
      for (const w of waves) {
        const wt = (t - w.delay) / 0.7
        if (wt <= 0 || wt >= 1) continue
        const radius = w.maxR * easeOut(wt)
        const alpha = (1 - wt) * 0.7
        gfx.circle(tx, ty, radius)
        gfx.stroke({ width: 0.5 + 3 * (1 - wt), color, alpha })
      }

      // 3) 粒子爆发：8 枚菱形碎片向外辐射并淡出
      const burstStart = 0.06
      const burstT = (t - burstStart) / 0.5
      if (burstT > 0 && burstT < 1) {
        const dist = 60 * easeOut(burstT)
        const pa = (1 - burstT) * 0.9
        const s = 1 + 4 * (1 - burstT)
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI * 2 * i) / 8 - Math.PI / 2
          const px = tx + Math.cos(ang) * dist
          const py = ty + Math.sin(ang) * dist
          gfx.moveTo(px, py - s)
          gfx.lineTo(px + s, py)
          gfx.lineTo(px, py + s)
          gfx.lineTo(px - s, py)
          gfx.closePath()
          gfx.fill({ color, alpha: pa })
        }
      }

      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        setTimeout(() => resolve(), 250)
      }
    }
    requestAnimationFrame(animate)
  })

  showPopupText(container, target, text, color)

  // 清理
  container.removeChild(gfx)
  gfx.destroy()

  if (text) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }
}
