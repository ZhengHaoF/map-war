/**
 * 地点坐标解析（公共算法）
 *
 * 将地点 id（城市 gb / 国家 iso_a3）解析为地图世界坐标系下的屏幕坐标，
 * 供动画函数（playArcAnimation / playScoutAnimation / startBattleAnimation）内部调用。
 *
 * 坐标空间说明：
 * 动画绘制在 worldContainer 中，该容器由 mapScale/mapX/mapY 控制缩放与平移，
 * 因此这里返回的是「未变换的世界坐标」= geoToScreen(经纬度, 画布尺寸)，
 * 与 LeafletMap 中 getFeatureCentroid 的算法完全一致。
 */

import { getDisplayName } from '@/data/displayNames'

// ─── 类型定义 ───

export interface Point {
  x: number
  y: number
}

export interface LatLng {
  lng: number
  lat: number
}

export interface ScreenSize {
  width: number
  height: number
}

export interface GeoBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

export interface CentroidResult {
  lng: number
  lat: number
  area: number
}

// ─── 地理边界 ───

export const GEO_BOUNDS: GeoBounds = {
  minLng: 73,
  maxLng: 135,
  minLat: 18,
  maxLat: 54,
}

// ─── 内部状态 ───

let screenSize: ScreenSize = { width: 1024, height: 768 }

/** id -> GeoJSON Feature 的注册表（城市用 gb，国家用 iso_a3） */
const featureById = new Map<string, GeoJSON.Feature>()

/** name -> id 的注册表（城市名 / 国名等自然语言地名解析用） */
const nameToId = new Map<string, string>()

/** id -> 中文名 的反向注册表（调试 / 显示用） */
const idToName = new Map<string, string>()

// ─── 公共 API ───

export function setScreenSize(width: number, height: number): void {
  screenSize = { width, height }
}

export function clearLocations(): void {
  featureById.clear()
  nameToId.clear()
  idToName.clear()
}

/**
 * 注册一批 GeoJSON features，以 properties[idKey] 作为查找 id。
 * 同步将 properties.name 注册到 nameToId（自然语言地名 → id），
 * 并将 id → name 写入 idToName（反向查找）。
 * 同时注册 properties.full_name（国家全称）作为输入别名。
 */
export function registerLocations(features: GeoJSON.Feature[], idKey: string): void {
  for (const f of features) {
    const id = f?.properties?.[idKey] as string | undefined
    if (id == null) continue

    featureById.set(id, f)

    const name = f.properties?.name
    if (name && typeof name === 'string') {
      if (!nameToId.has(name)) nameToId.set(name, id)
      if (!idToName.has(id)) idToName.set(id, name)
    }

    // 注册 full_name（国家全称，如"苏维埃社会主义共和国联盟"）
    const fullName = f.properties?.full_name
    if (fullName && typeof fullName === 'string' && fullName !== name && !nameToId.has(fullName)) {
      nameToId.set(fullName, id)
    }

    // 城市：同步注册 1931 年历史地名 → id
    if (idKey === 'gb') {
      const histName = getDisplayName(id)
      if (histName && !nameToId.has(histName)) {
        nameToId.set(histName, id)
      }
    }
  }
}

/**
 * 为同一 feature 注册一个别名 id（如现代国码 RUS → 游戏国码 SUN）。
 */
export function registerAlias(fromId: string, toId: string): void {
  const f = featureById.get(toId)
  if (f) featureById.set(fromId, f)
}

/**
 * 注册输入别名：将 alias 映射到 targetId，使 resolveLocationId(alias) 可解析。
 * 不改变 featureById，仅操作 nameToId。
 */
export function registerNameAlias(alias: string, targetId: string): void {
  if (!nameToId.has(alias) && featureById.has(targetId)) {
    nameToId.set(alias, targetId)
  }
}

export function geoToScreen(
  lng: number,
  lat: number,
  width: number = screenSize.width,
  height: number = screenSize.height,
): Point {
  const lngRange = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng
  const latRange = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat
  const scale = Math.min(width / lngRange, height / latRange)
  const x = (lng - GEO_BOUNDS.minLng) * scale
  const y = (GEO_BOUNDS.maxLat - lat) * scale
  return { x, y }
}

// ─── 质心计算 ───

function ringCentroid(ring: [number, number][]): CentroidResult | null {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  area /= 2
  const absArea = Math.abs(area)
  if (absArea === 0) return null
  cx /= 6 * area
  cy /= 6 * area
  return { lng: cx, lat: cy, area: absArea }
}

export function calculateCentroid(geometry: GeoJSON.Geometry | null): LatLng | null {
  if (!geometry) return null
  const polygons: [number, number][][] = []

  if (geometry.type === 'Polygon') {
    polygons.push(geometry.coordinates[0] as [number, number][])
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      polygons.push(polygon[0] as [number, number][])
    }
  }

  if (polygons.length === 0) return null

  let totalArea = 0
  let totalLng = 0
  let totalLat = 0
  for (const ring of polygons) {
    const c = ringCentroid(ring)
    if (!c) continue
    totalArea += c.area
    totalLng += c.lng * c.area
    totalLat += c.lat * c.area
  }
  if (totalArea === 0) return null
  return { lng: totalLng / totalArea, lat: totalLat / totalArea }
}

export function getFeatureScreenCenter(feature: GeoJSON.Feature): Point | null {
  if (!feature?.geometry) return null
  const c = calculateCentroid(feature.geometry)
  if (!c) return null
  return geoToScreen(c.lng, c.lat)
}

// ─── 地点查找 ───

/** 按 id 解析出 Feature（用于高亮） */
export function resolveLocation(id: string | null | undefined): GeoJSON.Feature | null {
  if (id == null) return null
  return featureById.get(id) || null
}

/** 按 id 解析出屏幕坐标 {x, y}（用于动画起终点） */
export function resolveLocationXY(id: string | null | undefined): Point | null {
  if (id == null) return null
  const f = featureById.get(id)
  if (!f) return null
  return getFeatureScreenCenter(f)
}

// ─── 地名解析 ───

/**
 * 按自然语言地名解析出 ID（gb / iso_a3）。文件内 helper，不对外暴露。
 * 解析策略：
 *   1. 精确匹配（注册名如「咸阳市」）
 *   2. 兜底「名称包含」匹配 —— 注册名中含该子串且唯一时返回（如「咸阳」→「咸阳市」）
 *   子串匹配多义（如「州」命中多城）则返回 null，让 AI 用更完整的名重试。
 * 无结果返回 null。
 */
function resolveLocationName(name: string): string | null {
  const exact = nameToId.get(name)
  if (exact) return exact

  let matchedId: string | null = null
  let matchedCount = 0
  for (const key of nameToId.keys()) {
    if (key.includes(name)) {
      matchedCount++
      if (matchedCount === 1) matchedId = nameToId.get(key)!
      if (matchedCount > 1) return null // 多义，放弃
    }
  }
  return matchedCount === 1 ? matchedId : null
}

/**
 * 地点解析统一入口（对外唯一）：先按自然语言地名查，查不到再当作 gb / iso_a3 直接查。
 * name 空间（中文）与 id 空间（数字 gb / 字母 iso_a3）不相交，故先查 name 不会误吞合法 id。
 * 既非 name 也非有效 id 时返回 null，调用方需判空。
 */
export function resolveLocationId(input: string): string | null {
  return resolveLocationName(input) ?? (resolveLocation(input) ? input : null)
}

/**
 * 调试用：返回所有注册名含 query 子串的条目（name + id）。
 * 便于排查「AI 传短名查不到」类问题（如注册名是「咸阳市」而 AI 传「咸阳」）。
 */
export function searchLocationNames(query: string): { name: string; id: string }[] {
  const q = query.trim()
  if (!q) return []
  const out: { name: string; id: string }[] = []
  for (const [name, id] of nameToId) {
    if (name.includes(q)) out.push({ name, id })
  }
  return out
}
