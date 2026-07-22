import raw from './chinaCities.seed.json'

export interface CityData {
  name: string
  gb: string
  owner?: string
  terrain?: string
  cityLevel?: number
  industry?: number
  food?: number
  fort?: number
  troops?: number // 驻军，单位：千（k）；势力总兵力 = 所辖城市 troops 之和（派生）
  morale?: number // 城市士气 0-100；势力士气 = 按兵力加权的各城 morale 均值（派生）
}

// 初始局势种子（1931-04-01），裸数据见 ./chinaCities.seed.json
// 过滤无 gb 的条目（如"境界线"标记），使其不进入已加载世界态
export const chinaCities = (raw as CityData[]).filter(c => c.gb)
