/**
 * 显示名映射 — 城市 + 国家统一入口。
 *
 * 地图 GeoJSON 和种子数据中的 name 是现代行政地名，
 * 本模块提供 id → 1931 年游戏内展示名的覆盖。
 *
 * key 约定：
 *   - 城市 = gb 编码（行政区划代码）
 *   - 国家 = iso_a3 编码
 *
 * 未映射的 id 返回 undefined，调用方自行 fallback 到种子名 / GeoJSON 名。
 */

// ── 城市 ──
const CITY: Record<string, string> = {
  // 北京 → 北平
  '156110000': '北平',
  // 沈阳 → 奉天
  '156210100': '奉天',
  // 丹东 → 安东
  '156210600': '安东',
  // 通化 → 浑江
  '156220600': '浑江',
  // 呼和浩特 → 归绥
  '156150100': '归绥',
  // 乌鲁木齐 → 迪化
  '156650100': '迪化',
  // 梅州 → 梅县
  '156441400': '梅县',
}

// ── 国家 ──
const COUNTRY: Record<string, string> = {
  // 如有需要在此添加，例如：
  // 'SUN': '苏维埃社会主义共和国联盟',
}

// ── 公共 API ──

const MAP: Record<string, string> = { ...CITY, ...COUNTRY }

/**
 * 按 id 查询 1931 年显示名（城市 gb / 国家 iso_a3）。
 * 无覆盖返回 undefined，调用方自行 fallback。
 */
export function getDisplayName(id: string): string | undefined {
  return MAP[id]
}
