/** Conservative, static forecast. Advisory only; never an order permission rule. */
import type { CityState } from '@/stores/game'
import type { Owner } from '@/data/owners'
import { computeFactionEconomy } from './economy'
import { occupationRemaining } from './supply'
import {
  UPKEEP_SILVER_PER_K,
  UPKEEP_FOOD_PER_K,
  RECRUIT_SILVER_PER_K,
  RECRUIT_FOOD_PER_K,
} from '@/data/gameConfig'

export const ECONOMY_RESERVE_TURNS = 3
export function resourceRunway(balance: number, net: number): number | null {
  if (balance < 0 || (balance === 0 && net < 0)) return 0
  if (net >= 0) return null
  return Math.max(0, Math.floor(balance / -net))
}
export function economyOutlook(
  cities: Record<string, CityState>,
  faction: Owner,
  turn: number,
  silver: number,
  food: number,
  activeWars = 0,
) {
  const eco = computeFactionEconomy(cities, faction, turn)
  const own = Object.values(cities).filter((c) => c.owner === faction)
  const pending = own.filter((c) => occupationRemaining(c, turn) > 0).length
  const silverRunway = resourceRunway(silver, eco.silverNet)
  const foodRunway = resourceRunway(food, eco.foodNet)
  const reserveSilver = Math.max(0, -eco.silverNet * ECONOMY_RESERVE_TURNS)
  const reserveFood = Math.max(0, -eco.foodNet * ECONOMY_RESERVE_TURNS)
  // One-off purchase + three turns of the new troops' upkeep. Negative current
  // cash flow gets no recruitment recommendation even when purchase is affordable.
  const maxRecruit =
    eco.silverNet < 0 || eco.foodNet < 0
      ? 0
      : Math.max(
          0,
          Math.min(
            eco.silverNet / UPKEEP_SILVER_PER_K,
            eco.foodNet / UPKEEP_FOOD_PER_K,
            Math.max(0, silver - reserveSilver) /
              (RECRUIT_SILVER_PER_K + ECONOMY_RESERVE_TURNS * UPKEEP_SILVER_PER_K),
            Math.max(0, food - reserveFood) /
              (RECRUIT_FOOD_PER_K + ECONOMY_RESERVE_TURNS * UPKEEP_FOOD_PER_K),
            100,
          ),
        )
  const recruitLimit = Math.floor(maxRecruit * 10) / 10
  const goal = !own.length
    ? '无领土'
    : food < 0 || eco.foodNet < 0
      ? '保粮'
      : silver < 0 || eco.silverNet < 0
        ? '补税'
        : pending > 0
          ? '整合'
          : activeWars > 0
            ? '支援战线'
            : own.some((c) => c.morale < 50 && c.troops + c.fieldForce > 0)
              ? '整备'
              : '择机扩张'
  const reason =
    goal === '保粮'
      ? '优先恢复粮食产出，避免新增长期养兵负担'
      : goal === '补税'
        ? '优先恢复税收与储备，当前不建议新增征兵'
        : goal === '整合'
          ? `${pending}座城市整合中，等待收入恢复并保护连接`
          : goal === '支援战线'
            ? '先核对现有战线兵力、补给和撤退条件，不重复开同一来源城'
            : goal === '整备'
              ? '先关注低士气部队与防守，再比较合法目标'
              : goal === '无领土'
                ? '本势力已无可经营城市'
                : '比较兵力、补给、路线费用，合法并不代表值得进攻'
  return {
    eco,
    silverRunway,
    foodRunway,
    reserveSilver,
    reserveFood,
    recruitLimit,
    goal,
    reason,
    pending,
  }
}
export function runwayLabel(turns: number | null): string {
  return turns === null ? '当前无净消耗' : `约${turns}回合`
}
