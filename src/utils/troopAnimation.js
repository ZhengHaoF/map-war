import { Graphics, Text, TextStyle } from 'pixi.js'

/**
 * 贝塞尔曲线插值（二阶）
 */
function bezier(t, p0, p1, p2) {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

/**
 * 绘制小箭头
 */
function drawArrow(gfx, x, y, angle, color = 0xffcc00) {
  const size = 8
  gfx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size)
  gfx.lineTo(x + Math.cos(angle + 2.5) * size * 0.7, y + Math.sin(angle + 2.5) * size * 0.7)
  gfx.lineTo(x + Math.cos(angle - 2.5) * size * 0.7, y + Math.sin(angle - 2.5) * size * 0.7)
  gfx.closePath()
  gfx.fill({ color, alpha: 1 })
}

/**
 * 弹出文字（在目的地上方飘出）
 */
function showPopupText(container, to, text, color = 0xffffff) {
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
  textObj.x = to.x
  textObj.y = to.y - 30
  container.addChild(textObj)

  const startTime = performance.now()
  const duration = 1200

  function animateText(now) {
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

/**
 * 播放弧线动画（通用）
 *
 * 模式：
 * - mode='dots'  : 多箭头沿弧线移动（适合派兵、行军）
 * - mode='orb'   : 光球沿弧线移动（适合宣战、施法）
 *
 * @param {Object} options
 * @param {{ x: number, y: number }} options.from - 起点屏幕坐标
 * @param {{ x: number, y: number }} options.to   - 终点屏幕坐标
 * @param {import('pixi.js').Container} options.container - 动画绘制的父容器
 * @param {'dots'|'orb'} [options.mode='dots'] - 动画模式
 * @param {boolean} [options.explosion=false] - 到达后是否爆炸
 * @param {number} [options.shockwaves=3] - 爆炸冲击波层数
 * @param {string} [options.text] - 到达后弹出的文字（可选）
 * @param {number} [options.textColor=0xffffff] - 弹出文字颜色
 * @param {import('pixi.js').Graphics} [options.highlightGfx] - 高亮图形对象（可选）
 * @param {Object} [options.fromFeature] - GeoJSON Feature，用于高亮出发地
 * @param {Object} [options.toFeature]   - GeoJSON Feature，用于高亮目的地
 * @param {(feature: Object, color: number) => void} [options.onHighlight] - 高亮回调
 * @param {number} [options.color=0xffcc00] - 动画颜色
 * @param {number} [options.dots=5]       - 小箭头数量（dots模式）
 * @param {number} [options.spacing=0.08] - 箭头间距（dots模式）
 * @param {number} [options.duration=2000] - 飞行时长（毫秒）
 * @param {number} [options.explosionDuration=800] - 爆炸时长（毫秒，仅explosion=true时生效）
 * @returns {Promise<void>}
 */
export async function playArcAnimation({
  from,
  to,
  container,
  mode = 'dots',
  explosion = false,
  shockwaves = 3,
  text,
  textColor = 0xffffff,
  highlightGfx,
  fromFeature,
  toFeature,
  onHighlight,
  color = 0xffcc00,
  dots = 5,
  spacing = 0.08,
  duration = 2000,
  explosionDuration = 800,
}) {
  // 高亮出发地和目的地
  if (highlightGfx && onHighlight) {
    highlightGfx.clear()
    if (fromFeature) onHighlight(fromFeature, color)
    if (toFeature) onHighlight(toFeature, color)
  }

  // 贝塞尔控制点（中点偏上，形成弧线）
  const p0 = from
  const p2 = to
  const p1 = {
    x: (p0.x + p2.x) / 2,
    y: Math.min(p0.y, p2.y) - Math.abs(p2.x - p0.x) * 0.3,
  }

  const animGfx = new Graphics()
  container.addChild(animGfx)

  // 阶段一：飞行
  const totalProgress = mode === 'dots' ? 1 + (dots - 1) * spacing : 1
  const startTime = performance.now()

  await new Promise((resolve) => {
    function animate(now) {
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

    await new Promise((resolve) => {
      function animateExplosion(now) {
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

          animGfx.circle(to.x, to.y, radius)
          animGfx.stroke({ width: 3 - i * 0.8, color, alpha })
        }

        // 中心光球
        const coreProgress = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7
        const coreRadius = 15 * coreProgress
        const coreAlpha = coreProgress * 0.8

        if (coreRadius > 0) {
          animGfx.circle(to.x, to.y, coreRadius)
          animGfx.fill({ color, alpha: coreAlpha })

          animGfx.circle(to.x, to.y, coreRadius * 0.5)
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

  // 弹出文字（在飞行或爆炸结束后）
  showPopupText(container, to, text, textColor)

  // 清理
  container.removeChild(animGfx)
  animGfx.destroy()
  if (highlightGfx) highlightGfx.clear()

  // 等待文字显示一段时间
  if (text) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * 播放探察动画 - 从起点向外扩散圆环
 *
 * @param {Object} options
 * @param {{ x: number, y: number }} options.from - 起点屏幕坐标
 * @param {import('pixi.js').Container} options.container - 动画绘制的父容器
 * @param {number} [options.color=0x22c55e] - 动画颜色（默认绿色）
 * @param {number} [options.rings=3] - 圆环数量
 * @param {number} [options.duration=1500] - 动画时长（毫秒）
 * @param {string} [options.text] - 弹出文字（可选）
 * @returns {Promise<void>}
 */
export async function playScoutAnimation({
  from,
  container,
  color = 0x22c55e,
  rings = 3,
  duration = 1500,
  text,
}) {
  const animGfx = new Graphics()
  container.addChild(animGfx)

  const startTime = performance.now()
  const maxRadius = 80

  await new Promise((resolve) => {
    function animate(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)

      animGfx.clear()

      for (let i = 0; i < rings; i++) {
        const ringProgress = Math.max(0, progress - i * 0.15)
        if (ringProgress <= 0) continue

        const radius = maxRadius * ringProgress
        const alpha = (1 - ringProgress) * 0.6

        animGfx.circle(from.x, from.y, radius)
        animGfx.stroke({ width: 2, color, alpha })
      }

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
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * 开始战斗动画 - 双向交火（持续动画，需手动停止）
 * 贝塞尔曲线路径，两种颜色小球相向移动
 *
 * @param {Object} options
 * @param {{ x: number, y: number }} options.from - 起点屏幕坐标
 * @param {{ x: number, y: number }} options.to - 终点屏幕坐标
 * @param {import('pixi.js').Container} options.container - 动画绘制的父容器
 * @param {import('pixi.js').Graphics} [options.highlightGfx] - 高亮图形对象（可选）
 * @param {Object} [options.fromFeature] - GeoJSON Feature，用于高亮出发地
 * @param {Object} [options.toFeature] - GeoJSON Feature，用于高亮目的地
 * @param {(feature: Object, color: number) => void} [options.onHighlight] - 高亮回调
 * @param {number} [options.colorA=0x3b82f6] - 出发方颜色（蓝色）
 * @param {number} [options.colorB=0xef4444] - 目标方颜色（红色）
 * @param {number} [options.dotsA=3] - A方小球数量
 * @param {number} [options.dotsB=3] - B方小球数量
 * @param {number} [options.spacing=0.15] - 小球间距
 * @param {number} [options.speed=0.004] - 每帧移动速度
 * @returns {{ stop: () => void, graphics: import('pixi.js').Graphics }} 控制对象
 */
export function startBattleAnimation({
  from,
  to,
  container,
  highlightGfx,
  fromFeature,
  toFeature,
  onHighlight,
  colorA = 0x3b82f6,
  colorB = 0xef4444,
  dotsA = 3,
  dotsB = 3,
  spacing = 0.15,
  speed = 0.004,
}) {
  // 高亮出发地和目的地（参考派兵模式）
  if (highlightGfx && onHighlight) {
    if (fromFeature) onHighlight(fromFeature, colorA)
    if (toFeature) onHighlight(toFeature, colorB)
  }

  // 贝塞尔控制点（和派兵模式一样）
  const p0 = from
  const p2 = to
  const p1 = {
    x: (p0.x + p2.x) / 2,
    y: Math.min(p0.y, p2.y) - Math.abs(p2.x - p0.x) * 0.3,
  }

  const animGfx = new Graphics()
  container.addChild(animGfx)

  let progressA = 0 // A方小球进度（0→1）
  let progressB = 0 // B方小球进度（0→1，反向）
  let running = true
  let rafId = null

  function animate() {
    if (!running) return

    animGfx.clear()

    // 画路径虚线（和派兵模式一样）
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

    // A方小球（从 from → to，蓝色）
    for (let i = 0; i < dotsA; i++) {
      const t = progressA - i * spacing
      if (t < 0 || t > 1) continue
      const pos = bezier(t, p0, p1, p2)
      const next = bezier(Math.min(t + 0.01, 1), p0, p1, p2)
      const angle = Math.atan2(next.y - pos.y, next.x - pos.x)
      drawArrow(animGfx, pos.x, pos.y, angle, colorA)
    }

    // B方小球（从 to → from，红色，用 1-t 实现反向）
    for (let i = 0; i < dotsB; i++) {
      const t = progressB - i * spacing
      if (t < 0 || t > 1) continue
      const pos = bezier(1 - t, p0, p1, p2) // 反向
      const next = bezier(Math.max(0, 1 - t - 0.01), p0, p1, p2)
      const angle = Math.atan2(next.y - pos.y, next.x - pos.x)
      drawArrow(animGfx, pos.x, pos.y, angle, colorB)
    }

    // 更新进度（循环）
    progressA += speed
    progressB += speed

    // 到达终点后重置（形成持续循环）
    const totalA = 1 + (dotsA - 1) * spacing
    const totalB = 1 + (dotsB - 1) * spacing
    if (progressA > totalA + 0.3) progressA = 0
    if (progressB > totalB + 0.3) progressB = 0

    rafId = requestAnimationFrame(animate)
  }

  rafId = requestAnimationFrame(animate)

  return {
    stop() {
      running = false
      if (rafId) cancelAnimationFrame(rafId)
      container.removeChild(animGfx)
      animGfx.destroy()
      // 清除高亮
      if (highlightGfx) highlightGfx.clear()
    },
    graphics: animGfx,
  }
}
