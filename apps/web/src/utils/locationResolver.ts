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

// ─── 公共 API ───

export function setScreenSize(width: number, height: number): void {
  screenSize = { width, height }
}

export function clearLocations(): void {
  featureById.clear()
}

/**
 * 注册一批 GeoJSON features，以 properties[idKey] 作为查找 id。
 */
export function registerLocations(features: GeoJSON.Feature[], idKey: string): void {
  for (const f of features) {
    const id = f?.properties?.[idKey] as string | undefined
    if (id != null) featureById.set(id, f)
  }
}

/**
 * 为同一 feature 注册一个别名 id（如现代国码 RUS → 游戏国码 SUN）。
 */
export function registerAlias(fromId: string, toId: string): void {
  const f = featureById.get(toId)
  if (f) featureById.set(fromId, f)
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
