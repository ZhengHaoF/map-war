import raw from './chinaCities.seed.adjacent.json'

export interface CityDataWithAdjacent {
  name: string
  gb: string
  owner?: string
  terrain?: string
  cityLevel?: number
  industry?: number
  food?: number
  fort?: number
  troops?: number
  morale?: number
  adjacent: string[]
}

/** 380 城邻接数据（含 adjacent: gb[]），供算法 B 接壤检测。 */
export const chinaCitiesAdjacent = raw as CityDataWithAdjacent[]
