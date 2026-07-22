import raw from './cityHistoricalNames.seed.json'

/**
 * 城市 gb → 1931 年地名映射。
 * 地图 GeoJSON（中国_市.geojson）中的 name 是现代行政地名，
 * 用本表将显示名覆盖为 1931 年历史地名。
 *
 * 本映射参考 GEO_TO_GAME_ISO 的设计：源数据不动，映射层独立。
 * 未映射的城市自动 fallback 到 GeoJSON / store 中的现代名。
 */
export const CITY_HISTORICAL_NAMES = raw as Record<string, string>

/**
 * 按 gb 查询 1931 年地名。
 * 无映射返回 undefined，调用方自行 fallback。
 */
export function getCityDisplayName(gb: string): string | undefined {
  return CITY_HISTORICAL_NAMES[gb]
}
