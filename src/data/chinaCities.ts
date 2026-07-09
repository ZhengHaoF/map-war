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
}

// 初始局势种子（1931-09-18），裸数据见 ./chinaCities.seed.json
export const chinaCities = raw as CityData[]
