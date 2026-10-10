/** Shared production/benchmark economic event builder. No state mutation. */
import type { CityState, GameEvent } from '@/stores/game'
import type { Owner } from '@/data/owners'
import { computeFactionEconomy } from './economy'
interface EconomicTickInput {
  cities: Record<string, CityState>
  activeFactions: Owner[]
  turnCount: number
  getTreasury(faction: Owner): number
  getGranary(faction: Owner): number
}
export function buildEconomicTickEvent(
  input: EconomicTickInput,
): Extract<GameEvent, { type: 'economicTick' }> {
  const entries = input.activeFactions.map((faction) => {
    const eco = computeFactionEconomy(input.cities, faction, input.turnCount)
    return {
      faction,
      silverDelta: eco.silverNet,
      foodDelta: eco.foodNet,
      silverTax: eco.silverTax,
      silverUpkeep: eco.silverUpkeep,
      foodProduce: eco.foodProduce,
      foodUpkeep: eco.foodUpkeep,
      arrear: input.getTreasury(faction) + eco.silverNet < 0,
      famine: input.getGranary(faction) + eco.foodNet < 0,
    }
  })
  return { type: 'economicTick', entries, attritionVersion: 2 }
}
