import raw from './chinaCities.seed.adjacent.json'
import type { CityData } from './chinaCities'

export interface CityDataWithAdjacent extends CityData {
  adjacent: string[]
}

/** 380 城邻接数据（含 adjacent: gb[]），供算法 B 接壤检测。 */
export const chinaCitiesAdjacent = raw as CityDataWithAdjacent[]
