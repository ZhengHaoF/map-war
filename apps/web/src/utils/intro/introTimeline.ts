/**
 * 新局开场动画时间轴（自样片 map-war-intro-demo 移植，分镜与时长不变）。
 *
 * computeFrame(t) 为纯函数：任意时刻都可直接求值，主时钟只负责推进 t，不依赖 setTimeout 链。
 * 完整版 18 秒六幕：落墨 / 题年 / 展卷 / 群雄 / 本方 / 受命；减少动态 3.6 秒淡入、无大幅镜头。
 */
export const FULL_DURATION = 18
export const REDUCED_DURATION = 3.6

export type ActId = 'luomo' | 'tinian' | 'zhanjuan' | 'qunxiong' | 'benfang' | 'shouming'
export interface IntroAct {
  id: ActId
  label: string
  no: string
  start: number
  end: number
}

export const ACTS_FULL: readonly IntroAct[] = [
  { id: 'luomo', label: '落墨', no: '壹', start: 0, end: 2.2 },
  { id: 'tinian', label: '题年', no: '贰', start: 2.2, end: 5.2 },
  { id: 'zhanjuan', label: '展卷', no: '叁', start: 5.2, end: 8.6 },
  { id: 'qunxiong', label: '群雄', no: '肆', start: 8.6, end: 11.8 },
  { id: 'benfang', label: '本方', no: '伍', start: 11.8, end: 15.4 },
  { id: 'shouming', label: '受命', no: '陆', start: 15.4, end: 18 },
]

export const ACTS_REDUCED: readonly IntroAct[] = [
  { id: 'luomo', label: '落墨', no: '壹', start: 0, end: 0.6 },
  { id: 'tinian', label: '题年', no: '贰', start: 0.6, end: 1.6 },
  { id: 'zhanjuan', label: '展卷', no: '叁', start: 1.6, end: 2.2 },
  { id: 'qunxiong', label: '群雄', no: '肆', start: 2.2, end: 2.6 },
  { id: 'benfang', label: '本方', no: '伍', start: 2.6, end: 3.0 },
  { id: 'shouming', label: '受命', no: '陆', start: 3.0, end: 3.6 },
]

export function actsFor(reduced: boolean): readonly IntroAct[] {
  return reduced ? ACTS_REDUCED : ACTS_FULL
}
export function durationFor(reduced: boolean): number {
  return reduced ? REDUCED_DURATION : FULL_DURATION
}
export function actAt(t: number, reduced: boolean): IntroAct {
  const acts = actsFor(reduced)
  for (const a of acts) if (t < a.end) return a
  return acts[acts.length - 1]!
}
/**
 * 地图闸门：第三幕“展卷”揭开真实地图之前必须 ready。
 * 第一、二幕只用 DOM，不依赖地图；闸门之前主时钟可以照常推进。
 */
export function mapGateFor(reduced: boolean): number {
  return reduced ? 1.6 : 5.6
}

export type CueKind =
  | 'drip'
  | 'drum'
  | 'seal'
  | 'unroll'
  | 'drumBig'
  | 'tap'
  | 'drumSoft'
  | 'stamp'
  | 'drumTail'
  | 'unrollShort'
export interface IntroCue {
  t: number
  kind: CueKind
}

export const CUES_FULL: readonly IntroCue[] = [
  { t: 0.45, kind: 'drip' },
  { t: 2.25, kind: 'drum' },
  { t: 4.6, kind: 'seal' },
  { t: 5.6, kind: 'unroll' },
  { t: 8.7, kind: 'drumBig' },
  ...Array.from({ length: 12 }, (_, i): IntroCue => ({ t: 8.85 + i * 0.17, kind: 'tap' })),
  { t: 11.9, kind: 'drum' },
  { t: 12.35, kind: 'drumSoft' },
  { t: 15.88, kind: 'stamp' },
  { t: 16.2, kind: 'drumTail' },
]
export const CUES_REDUCED: readonly IntroCue[] = [
  { t: 0.3, kind: 'drip' },
  { t: 1.2, kind: 'seal' },
  { t: 1.7, kind: 'unrollShort' },
  { t: 3.1, kind: 'stamp' },
]
export function cuesFor(reduced: boolean): readonly IntroCue[] {
  return reduced ? CUES_REDUCED : CUES_FULL
}
/** 正向播放从 prev 推进到 now 时跨越的提示点；跨越过久（长帧）不补播。 */
export function cuesBetween(prev: number, now: number, reduced: boolean): IntroCue[] {
  return cuesFor(reduced).filter((c) => c.t > prev && c.t <= now && now - c.t < 0.3)
}

// ---- 缓动 ----
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3)
export const easeInCubic = (x: number): number => x * x * x
export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
export const easeOutQuart = (x: number): number => 1 - Math.pow(1 - x, 4)
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2
export const easeOutSine = (x: number): number => Math.sin((x * Math.PI) / 2)
export const easeOutBack = (x: number): number => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
/** 0→1→0 的单峰 */
export const bump = (t: number, a: number, b: number): number => Math.sin(seg(t, a, b) * Math.PI)

export interface IntroFrame {
  coverOpacity: number
  blotScale: number
  blotOpacity: number
  washScale: number
  washOpacity: number
  chars: number[]
  dateOpacity: number
  smallSeal: number
  smallSealFade?: number
  titleOpacity: number
  coverOpen: number
  rodOpacity: number
  vignette: number
  seals: number[]
  sealFadeOnly?: boolean
  rosterOpacity: number
  qxTitle: number
  sealsDim: number
  ownSealBoost: number
  dimAlpha: number
  outline: number
  ownFill: number
  labels: number
  card: number
  neighbors: number[]
  stampDrop: number
  stampFade?: number
  stampImpact: number
  stampRing: number
  decree: number
  lockup: number
  /** 收尾：入场层与遮罩整体淡出，与 HUD 淡入衔接（1 = 完全可见） */
  exit: number
  end: number
}

export function computeFrame(t: number, reduced: boolean, sealCount = 12): IntroFrame {
  return reduced ? reducedFrame(t, sealCount) : fullFrame(t, sealCount)
}

function fullFrame(t: number, n: number): IntroFrame {
  const blotIn = seg(t, 0.45, 2.1)
  return {
    // 一 · 落墨
    coverOpacity: easeInOutSine(seg(t, 0, 0.6)),
    blotScale: 0.06 + 0.94 * easeOutQuart(blotIn),
    blotOpacity: 0.94 * easeOutCubic(seg(t, 0.45, 0.8)) * (1 - 0.88 * easeInOutSine(seg(t, 5.0, 6.0))),
    washScale: 0.3 + 1.2 * easeOutCubic(seg(t, 0.6, 3.4)),
    washOpacity: 0.42 * easeOutCubic(seg(t, 0.7, 1.6)) * (1 - easeInOutSine(seg(t, 5.2, 6.2))),
    // 二 · 题年：四字逐笔
    chars: [0, 1, 2, 3].map((i) => easeInOutSine(seg(t, 2.3 + i * 0.38, 2.3 + i * 0.38 + 0.62))),
    dateOpacity: easeOutCubic(seg(t, 3.95, 4.6)),
    smallSeal: seg(t, 4.55, 4.85),
    titleOpacity: 1 - easeInOutSine(seg(t, 5.25, 5.95)),
    // 三 · 展卷
    coverOpen: easeInOutCubic(seg(t, 5.6, 7.7)),
    rodOpacity: easeOutCubic(seg(t, 5.5, 5.8)) * (1 - easeInOutSine(seg(t, 7.4, 8.1))),
    vignette: 0.55 + 0.25 * seg(t, 5.6, 8.6),
    // 四 · 群雄
    seals: Array.from({ length: n }, (_, i) => seg(t, 8.85 + i * 0.17, 8.85 + i * 0.17 + 0.42)),
    rosterOpacity: easeOutCubic(seg(t, 8.75, 9.3)) * (1 - easeInOutSine(seg(t, 11.7, 12.3))),
    qxTitle: easeOutCubic(seg(t, 8.8, 9.6)) * (1 - easeInOutSine(seg(t, 11.3, 12.0))),
    // 五 · 本方
    sealsDim: easeInOutSine(seg(t, 11.8, 12.5)),
    ownSealBoost: easeInOutSine(seg(t, 11.9, 12.8)) * (1 - easeInOutSine(seg(t, 15.4, 15.9))),
    dimAlpha: 0.5 * easeInOutSine(seg(t, 12.0, 13.1)) - 0.18 * easeInOutSine(seg(t, 17.0, 18.0)),
    outline: easeInOutSine(seg(t, 12.4, 13.6)),
    ownFill: 0.32 * easeInOutSine(seg(t, 12.2, 13.4)),
    labels: easeOutCubic(seg(t, 13.3, 14.2)),
    card: easeOutCubic(seg(t, 13.2, 14.1)) * (1 - easeInOutSine(seg(t, 16.9, 17.6))),
    neighbors: [0, 1, 2, 3].map((i) => easeOutCubic(seg(t, 14.0 + i * 0.16, 14.45 + i * 0.16))),
    // 六 · 受命
    stampDrop: seg(t, 15.5, 15.88),
    stampImpact: bump(t, 15.86, 16.18),
    stampRing: seg(t, 15.86, 16.9),
    decree: easeOutCubic(seg(t, 16.15, 16.8)),
    lockup: easeInOutCubic(seg(t, 17.0, 17.9)),
    exit: 1 - easeInOutSine(seg(t, 17.5, 18)),
    end: t >= FULL_DURATION ? 1 : 0,
  }
}

function reducedFrame(t: number, n: number): IntroFrame {
  // 减少动态：只做交叉淡入，不缩放、不展卷位移、不推镜
  const ti = easeInOutSine(seg(t, 0.6, 1.1))
  const s = easeInOutSine(seg(t, 2.1, 2.5))
  return {
    coverOpacity: easeInOutSine(seg(t, 0, 0.5)) * (1 - easeInOutSine(seg(t, 1.6, 2.3))),
    blotScale: 1,
    blotOpacity: 0.9 * easeInOutSine(seg(t, 0.25, 0.7)) * (1 - easeInOutSine(seg(t, 1.6, 2.3))),
    washScale: 1.3,
    washOpacity: 0.3 * easeInOutSine(seg(t, 0.3, 0.8)) * (1 - easeInOutSine(seg(t, 1.6, 2.3))),
    chars: [ti, ti, ti, ti],
    dateOpacity: easeInOutSine(seg(t, 0.9, 1.3)),
    smallSeal: seg(t, 1.15, 1.4) > 0 ? 1 : 0,
    smallSealFade: easeInOutSine(seg(t, 1.15, 1.4)),
    titleOpacity: 1,
    coverOpen: 0,
    rodOpacity: 0,
    vignette: 0.75,
    seals: Array.from({ length: n }, () => s),
    sealFadeOnly: true,
    rosterOpacity: 0,
    qxTitle: 0,
    sealsDim: easeInOutSine(seg(t, 2.5, 2.9)),
    ownSealBoost: 0,
    dimAlpha: 0.32 * easeInOutSine(seg(t, 2.5, 3.0)),
    outline: easeInOutSine(seg(t, 2.5, 3.0)),
    ownFill: 0.32 * easeInOutSine(seg(t, 2.5, 3.0)),
    labels: easeInOutSine(seg(t, 2.6, 3.1)),
    card: 0,
    neighbors: [0, 0, 0, 0],
    stampDrop: 1,
    stampFade: easeInOutSine(seg(t, 3.0, 3.35)),
    stampImpact: 0,
    stampRing: 0,
    decree: easeInOutSine(seg(t, 3.1, 3.5)),
    lockup: 1,
    exit: 1 - easeInOutSine(seg(t, 3.35, 3.6)),
    end: t >= REDUCED_DURATION ? 1 : 0,
  }
}

export type ShotName = 'wide' | 'national' | 'drift' | 'faction' | 'final'
export interface CameraKey {
  a: ShotName
  b: ShotName
  k: number
}

/**
 * 相机关键段：wide（略广全国）→ national → drift（群雄缓推）→ faction（本方）→ final（终态）。
 * 减少动态：闸门前停在 wide（被遮罩盖住），之后直接跳到 final，没有补间。
 */
export function cameraKey(t: number, reduced: boolean): CameraKey {
  if (reduced) return t < 1.6 ? { a: 'wide', b: 'wide', k: 0 } : { a: 'final', b: 'final', k: 0 }
  if (t < 5.6) return { a: 'wide', b: 'wide', k: 0 }
  if (t < 8.6) return { a: 'wide', b: 'national', k: easeInOutCubic(seg(t, 5.6, 8.6)) }
  if (t < 11.9) return { a: 'national', b: 'drift', k: easeInOutSine(seg(t, 8.6, 11.9)) }
  if (t < 14.8) return { a: 'drift', b: 'faction', k: easeInOutCubic(seg(t, 11.9, 14.8)) }
  return { a: 'faction', b: 'final', k: easeOutSine(seg(t, 14.8, 18)) }
}

/** 1931-04-01 → { year: 一九三一, full: 一九三一年四月一日 } */
const DIG = '〇一二三四五六七八九'
function cnNum(n: number): string {
  if (n <= 10) return n === 10 ? '十' : DIG[n]!
  if (n < 20) return '十' + DIG[n - 10]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return DIG[tens] + '十' + (ones ? DIG[ones] : '')
}
export function formatCnDate(iso: string): { year: string; full: string } {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso || ''))
  if (!m) return { year: '一九三一', full: '一九三一年' }
  const year = m[1]!
    .split('')
    .map((d) => DIG[+d])
    .join('')
  return { year, full: `${year}年${cnNum(+m[2]!)}月${cnNum(+m[3]!)}日` }
}
