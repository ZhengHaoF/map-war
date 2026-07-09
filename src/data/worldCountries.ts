import raw from './worldCountries.seed.json'

export interface CountryData {
  id: string
  iso_a3: string
  name: string
  full_name: string
  countryType: string
  military: number
  industry: number
  population: number
  threat: number
  diplomacy: string
}

/**
 * 现代 GeoJSON iso_a3 → 1931 游戏 iso_a3 映射
 * GeoJSON 文件用的是现代国家代码，游戏数据用的是 1931 年代代码
 */
export const GEO_TO_GAME_ISO: Record<string, string> = {
  RUS: 'SUN',    // 俄罗斯 → 苏联
  // 如有更多不一致，在此添加
}

// 初始局势种子（1931），裸数据见 ./worldCountries.seed.json
export const worldCountries = raw as CountryData[]
