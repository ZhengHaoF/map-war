/**
 * 新局开场的数据计划（纯函数，只读世界态与静态数据，不写任何状态）。
 *
 * - IntroCast：字幕 / 印章 / 名录 / 四邻 / 焦点城等文本与颜色，来自实际 store.playerName 与
 *   store.currentFaction，以及 OWNER_LABELS / OWNER_DETAILS / OWNER_COLORS 现成游戏文本。
 * - IntroShots：镜头取景，依赖地图已注册的城市几何（局部世界坐标，与 worldContainer 一致）。
 */
import { Owner, OWNER_COLORS, OWNER_DETAILS, OWNER_LABELS } from '@/data/owners'

/** 名录顺序与择势页一致 */
export const INTRO_FACTION_ORDER: readonly Owner[] = [
  Owner.KMT,
  Owner.CCP,
  Owner.JPN,
  Owner.NEA,
  Owner.SHX,
  Owner.GXC,
  Owner.SCC,
  Owner.MA,
  Owner.XJ,
  Owner.TIB,
  Owner.YUN,
  Owner.GUI,
]

/**
 * 焦点城候选（显式 gb 映射，运行时仍校验“存在、已注册、开局归本方”）。
 * 不解析 OWNER_DETAILS.capital 展示文本：瑞金不在城市种子中、重庆开局归国府等。
 */
export const INTRO_FOCUS_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  [Owner.KMT]: ['156320100'], // 南京
  [Owner.CCP]: ['156360700', '156360100'], // 赣州（瑞金所在）/ 南昌
  [Owner.JPN]: ['156210200'], // 大连（旅顺所在）
  [Owner.NEA]: ['156210100'], // 沈阳
  [Owner.SHX]: ['156140100'], // 太原
  [Owner.GXC]: ['156450100'], // 南宁
  [Owner.SCC]: ['156510100', '156500000'], // 成都 / 重庆（开局归国府时不采用）
  [Owner.MA]: ['156630100', '156620100'], // 西宁 / 兰州
  [Owner.XJ]: ['156650100'], // 乌鲁木齐（迪化）
  [Owner.TIB]: ['156540100'], // 拉萨
  [Owner.YUN]: ['156530100'], // 昆明
  [Owner.GUI]: ['156520100'], // 贵阳
}

export const PLAYER_NAME_MAX = 12
export const PLAYER_NAME_FALLBACK = '无名'

export interface IntroCityLike {
  gb: string
  name: string
  owner: string
  troops?: number
}

export interface IntroCastInput {
  faction: Owner
  playerName: string
  cities: Readonly<Record<string, IntroCityLike>>
  activeFactions?: readonly string[]
  /** gb → 相邻 gb（陆路 / 海路）。缺省视为没有连接。 */
  neighboursOf?: (gb: string) => readonly string[]
  /** 只含陆路的相邻，用于主体疆域连通（海路飞地不入取景）。缺省同 neighboursOf。 */
  landNeighboursOf?: (gb: string) => readonly string[]
  /** 地图是否已注册该 gb（未就绪时可省略，视为可用） */
  isRegistered?: (gb: string) => boolean
}

export interface IntroOwnerSeal {
  id: Owner
  label: string
  char: string
  color: string
  focusGb: string | null
}

export interface IntroCast {
  faction: Owner
  factionLabel: string
  sealChar: string
  color: string
  fullName: string
  leader: string
  personality: string
  /** 纯文本玩家名（Vue 文本插值渲染，绝不作为 HTML） */
  playerName: string
  focus: { gb: string; name: string } | null
  ownGbs: string[]
  /** 本方主体疆域：从焦点城沿陆路连通的本方城市（排除台湾等海路飞地） */
  clusterGbs: string[]
  neighbors: IntroOwnerSeal[]
  roster: IntroOwnerSeal[]
}

export function ownerHex(owner: string): string {
  const n = (OWNER_COLORS as Record<string, number>)[owner] ?? 0x888888
  return '#' + n.toString(16).padStart(6, '0')
}

/** 玩家名：去首尾空白、按码点截断到 12、空则“无名”。只做截断，不做任何 HTML 处理（由 Vue 文本插值转义）。 */
export function displayPlayerName(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return PLAYER_NAME_FALLBACK
  return Array.from(s).slice(0, PLAYER_NAME_MAX).join('')
}

function ownCities(cities: Readonly<Record<string, IntroCityLike>>, owner: string): IntroCityLike[] {
  return Object.values(cities).filter((c) => c && c.owner === owner)
}

/**
 * 焦点城：候选表中第一个“存在、已注册、归本方”的 gb；否则本方驻军最多（并列取 gb 小者）的已注册城市；
 * 再否则本方任意城市；都没有则 null。
 */
export function resolveFocusCity(
  owner: string,
  cities: Readonly<Record<string, IntroCityLike>>,
  isRegistered: (gb: string) => boolean = () => true,
): IntroCityLike | null {
  for (const gb of INTRO_FOCUS_CANDIDATES[owner] ?? []) {
    const c = cities[gb]
    if (c && c.owner === owner && isRegistered(gb)) return c
  }
  const own = ownCities(cities, owner).sort(
    (a, b) => (b.troops ?? 0) - (a.troops ?? 0) || (a.gb < b.gb ? -1 : 1),
  )
  return own.find((c) => isRegistered(c.gb)) ?? own[0] ?? null
}

/** 由连接表构造邻接查询；onlyKind 限定连接类型（如只要 'land'）。 */
export function connectionNeighbours(
  edges: readonly { from: string; to: string; kind?: string }[],
  onlyKind?: string,
): (gb: string) => readonly string[] {
  const map = new Map<string, string[]>()
  for (const e of edges) {
    if (onlyKind && e.kind !== onlyKind) continue
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      const l = map.get(a)
      if (l) l.push(b)
      else map.set(a, [b])
    }
  }
  return (gb) => map.get(gb) ?? []
}

/** 从 seed 出发，只经本方城市、只走 isLand 允许的连接，求连通分量。 */
export function factionCluster(
  owner: string,
  seedGb: string | null,
  cities: Readonly<Record<string, IntroCityLike>>,
  neighboursOf: (gb: string) => readonly string[],
): string[] {
  if (!seedGb || cities[seedGb]?.owner !== owner) return []
  const seen = new Set<string>([seedGb])
  const queue = [seedGb]
  while (queue.length) {
    const gb = queue.shift()!
    for (const n of neighboursOf(gb)) {
      if (seen.has(n) || cities[n]?.owner !== owner) continue
      seen.add(n)
      queue.push(n)
    }
  }
  return [...seen]
}

/** 四邻：本方城市相邻的他方势力，按接壤城市对数降序，取前 n。 */
export function computeNeighborOwners(
  owner: string,
  cities: Readonly<Record<string, IntroCityLike>>,
  neighboursOf: (gb: string) => readonly string[],
  validIds: ReadonlySet<string>,
  n = 4,
): string[] {
  const score = new Map<string, number>()
  for (const c of ownCities(cities, owner)) {
    for (const nb of neighboursOf(c.gb)) {
      const o = cities[nb]?.owner
      if (!o || o === owner || !validIds.has(o)) continue
      score.set(o, (score.get(o) ?? 0) + 1)
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || INTRO_FACTION_ORDER.indexOf(a[0] as Owner) - INTRO_FACTION_ORDER.indexOf(b[0] as Owner))
    .slice(0, n)
    .map(([o]) => o)
}

function sealOf(id: Owner, cities: Readonly<Record<string, IntroCityLike>>, isRegistered: (gb: string) => boolean): IntroOwnerSeal {
  const label = OWNER_LABELS[id] ?? id
  return {
    id,
    label,
    char: Array.from(label)[0] ?? '',
    color: ownerHex(id),
    focusGb: resolveFocusCity(id, cities, isRegistered)?.gb ?? null,
  }
}

export function buildIntroCast(input: IntroCastInput): IntroCast {
  const { faction, cities } = input
  const isRegistered = input.isRegistered ?? (() => true)
  const neighboursOf = input.neighboursOf ?? (() => [])
  const active = (input.activeFactions ?? INTRO_FACTION_ORDER).filter((f) => f !== Owner.NEUTRAL)
  const rosterIds = INTRO_FACTION_ORDER.filter((f) => active.includes(f))
  if (!rosterIds.includes(faction)) rosterIds.push(faction)
  const detail = OWNER_DETAILS[faction]
  const label = OWNER_LABELS[faction] ?? String(faction)
  const focus = resolveFocusCity(faction, cities, isRegistered)
  const validIds = new Set<string>(rosterIds)
  const neighborIds = computeNeighborOwners(faction, cities, neighboursOf, validIds, 4)
  return {
    faction,
    factionLabel: label,
    sealChar: Array.from(label)[0] ?? '',
    color: ownerHex(faction),
    fullName: detail?.fullName ?? '',
    leader: detail?.leader ?? '',
    personality: detail?.personality ?? '',
    playerName: displayPlayerName(input.playerName),
    focus: focus ? { gb: focus.gb, name: focus.name } : null,
    ownGbs: ownCities(cities, faction).map((c) => c.gb),
    clusterGbs: factionCluster(faction, focus?.gb ?? null, cities, input.landNeighboursOf ?? neighboursOf),
    neighbors: neighborIds.map((id) => sealOf(id as Owner, cities, isRegistered)),
    roster: rosterIds.map((id) => sealOf(id, cities, isRegistered)),
  }
}

// ───────────── 取景 ─────────────

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
export interface Shot {
  /** 屏幕中心对应的局部世界坐标 */
  cx: number
  cy: number
  /** 缩放（= LeafletMap mapScale） */
  z: number
}
export interface CameraTargetLike {
  scale: number
  x: number
  y: number
}
export interface IntroShots {
  wide: Shot
  national: Shot
  drift: Shot
  faction: Shot
  final: Shot
}
export interface ShotInput {
  viewport: { width: number; height: number }
  /** gb → 局部世界坐标外接框 */
  boxes: ReadonlyMap<string, Box>
  /** 只框这些 gb（本方主体疆域）；空则退回全部本方，再退回全国 */
  clusterGbs: readonly string[]
  ownGbs: readonly string[]
  /** 局部坐标中每经纬度对应的长度，用于小势力最小视野 */
  unitsPerDegree: number
  /** 北纬 17° 对应的局部 y：外接框中心更靠南的城市（南海岛礁）不参与取景 */
  southCutY: number
  zoomMin: number
  zoomMax: number
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}
export function unionBoxes(list: Iterable<Box>, southCutY = Infinity): Box | null {
  const b = emptyBox()
  const all: Box[] = [...list]
  const main = all.filter((x) => (x.minY + x.maxY) / 2 <= southCutY)
  for (const x of main.length ? main : all) {
    b.minX = Math.min(b.minX, x.minX)
    b.minY = Math.min(b.minY, x.minY)
    b.maxX = Math.max(b.maxX, x.maxX)
    b.maxY = Math.max(b.maxY, x.maxY)
  }
  return Number.isFinite(b.minX) && Number.isFinite(b.maxY) ? b : null
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
function fitShot(box: Box, rect: Rect, vw: number, vh: number, minW = 0, minH = 0): Shot {
  const bw = Math.max(box.maxX - box.minX, minW, 1e-6)
  const bh = Math.max(box.maxY - box.minY, minH, 1e-6)
  const z = Math.min(rect.w / bw, rect.h / bh)
  const bx = (box.minX + box.maxX) / 2
  const by = (box.minY + box.maxY) / 2
  return { cx: bx + (vw / 2 - (rect.x + rect.w / 2)) / z, cy: by + (vh / 2 - (rect.y + rect.h / 2)) / z, z }
}
const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(v, a), b)

export function computeIntroShots(input: ShotInput): IntroShots | null {
  const vw = Math.max(1, input.viewport.width)
  const vh = Math.max(1, input.viewport.height)
  const china = unionBoxes(input.boxes.values(), input.southCutY)
  if (!china) return null
  const mobile = vw < 640
  const pick = (gbs: readonly string[]): Box[] =>
    gbs.map((gb) => input.boxes.get(gb)).filter((b): b is Box => !!b)
  const ownBox =
    unionBoxes(pick(input.clusterGbs), input.southCutY) ??
    unionBoxes(pick(input.ownGbs), input.southCutY) ??
    china
  const nRect = mobile
    ? { x: vw * 0.04, y: vh * 0.14, w: vw * 0.92, h: vh * 0.58 }
    : { x: vw * 0.06, y: vh * 0.1, w: vw * 0.88, h: vh * 0.7 }
  const national = fitShot(china, nRect, vw, vh)
  const zr = (z: number): number => clamp(z, input.zoomMin, input.zoomMax)
  national.z = zr(national.z)
  const wide = { cx: national.cx, cy: national.cy - 0.6 * input.unitsPerDegree, z: zr(national.z * 0.74) }
  const drift = { ...national, z: zr(national.z * 1.05) }
  const u = input.unitsPerDegree
  const fRect = mobile
    ? { x: vw * 0.06, y: vh * 0.1, w: vw * 0.88, h: vh * 0.42 }
    : { x: vw * 0.07, y: vh * 0.12, w: vw * 0.53, h: vh * 0.72 }
  const faction = fitShot(ownBox, fRect, vw, vh, 8.8 * u, 5.3 * u)
  // 终态缩放：不比全国更广，也不超过 ZOOM 上限；不用 FOCUS_SCALE 那种特写
  faction.z = clamp(faction.z, national.z, input.zoomMax)
  const eRect = mobile
    ? { x: vw * 0.06, y: vh * 0.1, w: vw * 0.88, h: vh * 0.5 }
    : { x: vw * 0.18, y: vh * 0.08, w: vw * 0.7, h: vh * 0.7 }
  const z = clamp(faction.z * 1.04, input.zoomMin, input.zoomMax)
  const bx = (ownBox.minX + ownBox.maxX) / 2
  const by = (ownBox.minY + ownBox.maxY) / 2
  const final = {
    cx: bx + (vw / 2 - (eRect.x + eRect.w / 2)) / z,
    cy: by + (vh / 2 - (eRect.y + eRect.h / 2)) / z,
    z,
  }
  return { wide, national, drift, faction, final }
}

export function lerpShot(a: Shot, b: Shot, k: number): Shot {
  if (k <= 0 || a === b) return a
  if (k >= 1) return b
  return {
    cx: a.cx + (b.cx - a.cx) * k,
    cy: a.cy + (b.cy - a.cy) * k,
    z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * k),
  }
}

/** Shot → LeafletMap 相机 {scale, x, y}（screen = local * scale + (x, y)） */
export function shotToCamera(s: Shot, viewport: { width: number; height: number }): CameraTargetLike {
  return { scale: s.z, x: viewport.width / 2 - s.cx * s.z, y: viewport.height / 2 - s.cy * s.z }
}
