import raw from './worldCountries.seed.json'

export interface CountryData {
  id: string
  iso_a3: string
  name: string
  full_name: string
  countryType: string
  military: number // 军事实力评分（1-10），代表军队质量/装备/训练水平
  industry: number // 工业能力评分（0-100），代表装备水平与工业产能
  population: number // 人口（单位：千人），实数值
  troops: number // 驻军（单位：千人）
  fieldForce: number // 外出兵力（单位：千人），开战出兵后从此扣
  threat: number // 对华威胁度（0-10）
  diplomacy: string // 外交关系 NEUTRAL/HOSTILE/ALLIED
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

/** iso_a3 → 中文国名（如 SUN → 苏联）；未知回传原值 */
export function countryName(iso: string): string {
  return worldCountries.find((c) => c.iso_a3 === iso)?.name ?? iso
}

/** 可遣使的列强国家 iso 列表（COUNTRY_COMMS 有领袖人设者） */
export const COUNTRY_OPTIONS = Object.keys(COUNTRY_COMMS)
