/** 程序化墨晕（自样片移植）：一次性绘入 Canvas，演出时只改 transform / opacity，不用粒子。 */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export function drawInkBlot(canvas: HTMLCanvasElement, color = '#14100c', seed = 1931): void {
  const size = 900
  canvas.width = size
  canvas.height = size
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return
  const r = rng(seed)
  const c = size / 2
  ctx.clearRect(0, 0, size, size)

  // 外层淡晕：宣纸吸水的毛边
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2
    const d = 120 + r() * 210
    const rad = 60 + r() * 150
    const x = c + Math.cos(a) * d * 0.9
    const y = c + Math.sin(a) * d
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, rgba(color, 0.1 + r() * 0.08))
    g.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rad, 0, Math.PI * 2)
    ctx.fill()
  }

  // 主墨体：不规则多边形叠加，边缘有起伏
  for (let layer = 0; layer < 5; layer++) {
    const base = 300 - layer * 34
    ctx.beginPath()
    const steps = 140
    const phase = r() * 10
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const wob =
        Math.sin(a * 3 + phase) * 0.07 +
        Math.sin(a * 7 + phase * 1.7) * 0.045 +
        Math.sin(a * 17 + phase * 0.6) * 0.02 +
        (r() - 0.5) * 0.025
      const rad = base * (1 + wob)
      const x = c + Math.cos(a) * rad * 0.92
      const y = c + Math.sin(a) * rad * 1.04
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = rgba(color, layer === 0 ? 0.38 : 0.2 + layer * 0.07)
    ctx.fill()
  }

  // 核心浓墨
  const core = ctx.createRadialGradient(c - 20, c - 30, 10, c, c, 250)
  core.addColorStop(0, rgba(color, 0.95))
  core.addColorStop(0.7, rgba(color, 0.7))
  core.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(c, c, 250, 0, Math.PI * 2)
  ctx.fill()

  // 飞溅墨点
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const d = 300 + r() * 120
    const rad = 2 + r() * 9
    ctx.fillStyle = rgba(color, 0.35 + r() * 0.5)
    ctx.beginPath()
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, rad, 0, Math.PI * 2)
    ctx.fill()
  }

  // 纸纤维方向的细丝渗墨
  ctx.lineCap = 'round'
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2
    const d0 = 250 + r() * 40
    const len = 20 + r() * 70
    ctx.strokeStyle = rgba(color, 0.08 + r() * 0.14)
    ctx.lineWidth = 0.6 + r() * 1.6
    ctx.beginPath()
    ctx.moveTo(c + Math.cos(a) * d0, c + Math.sin(a) * d0)
    const a2 = a + (r() - 0.5) * 0.3
    ctx.lineTo(c + Math.cos(a2) * (d0 + len), c + Math.sin(a2) * (d0 + len))
    ctx.stroke()
  }
}
