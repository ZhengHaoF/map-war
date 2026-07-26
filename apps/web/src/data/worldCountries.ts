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
  RUS: 'SUN', // 俄罗斯 → 苏联
  // 如有更多不一致，在此添加
}

// 初始局势种子（1931），裸数据见 ./worldCountries.seed.json
export const worldCountries = raw as CountryData[]

/**
 * 国家电报通讯属性（回信所需，与地图展示用的 CountryData 解耦）
 * key = CountryData.iso_a3
 */
export interface CountryComms {
  leader: string
  personality: string
  color: number
}

export const COUNTRY_COMMS: Record<string, CountryComms> = {
  JPN: { leader: '犬养毅', personality: '咄咄逼人·扩张野心', color: 0x8a6d9c },
  SUN: { leader: '斯大林', personality: '务实谨慎·不轻信西方', color: 0xb25144 },
  USA: { leader: '胡佛', personality: '孤立主义·商人本色', color: 0x5f7fa6 },
  GBR: { leader: '麦克唐纳', personality: '老练务实·殖民思维', color: 0x4a6a92 },
  FRA: { leader: '赖伐尔', personality: '谨慎狡黠·欧陆关切', color: 0x5878a8 },
  DEU: { leader: '兴登堡', personality: '威严持重·凡尔赛怨恨', color: 0x7a7a72 },
  ITA: { leader: '墨索里尼', personality: '狂妄自信·地中海野心', color: 0x6f9468 },
}
