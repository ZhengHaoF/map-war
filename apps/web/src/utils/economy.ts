/**
 * 经济系统 —— 纯公式模块（不依赖 store，方便调参与测试）。
 *
 * 设计原则：
 * - 基础循环（税收/养兵）= 本地确定性公式，零 LLM 调用，replay 安全
 * - 经济事件（旱灾/赔款/截断商路）= AI 通过 freeAction effects 产出（treasuryChange/granaryChange）
 * - 动作成本（征兵/建设/筑防/整军）= 本地前置拦截
 *
 * 单位约定：
 * - 银库 treasury：万银（1 万银 ≈ 1 万大洋）
 * - 粮仓 granary：万石
 * - 兵力：千（k），与 CityState.troops/fieldForce 一致
 *
 * 所有系数统一定义在 src/data/gameConfig.ts，改一个数全局生效。
 */

import type { CityState } from '@/stores/game'
import { Owner } from '@/data/owners'
import {
  TAX_PER_CITY_LEVEL,
  TAX_PER_INDUSTRY,
  FOOD_PER_FOOD_POINT,
  UPKEEP_SILVER_PER_K,
  UPKEEP_FOOD_PER_K,
  RECRUIT_SILVER_PER_K,
  RECRUIT_FOOD_PER_K,
  DEVELOP_SILVER_PER_POINT,
  FORTIFY_SILVER_PER_POINT,
  RALLY_SILVER_FLAT,
  MARCH_SILVER_PER_KM_PER_K,
  MARCH_FOOD_PER_KM_PER_K,
  EXPEDITION_DECAY_REF_KM,
  EXPEDITION_DECAY_FLOOR,
  ARREAR_MORALE_PENALTY,
  FAMINE_TROOP_LOSS_RATE,
  INIT_TREASURY_UPKEEP_MULTIPLIER,
  INIT_TREASURY_FLOOR,
  INIT_GRANARY_UPKEEP_MULTIPLIER,
  INIT_GRANARY_FLOOR,
} from '@/data/gameConfig'

// 向后兼容：保留旧导出，避免外部 import 断链
export {
  TAX_PER_CITY_LEVEL,
  TAX_PER_INDUSTRY,
  FOOD_PER_FOOD_POINT,
  UPKEEP_SILVER_PER_K,
  UPKEEP_FOOD_PER_K,
  RECRUIT_SILVER_PER_K,
  RECRUIT_FOOD_PER_K,
  DEVELOP_SILVER_PER_POINT,
  FORTIFY_SILVER_PER_POINT,
  RALLY_SILVER_FLAT,
  MARCH_SILVER_PER_KM_PER_K,
  MARCH_FOOD_PER_KM_PER_K,
  EXPEDITION_DECAY_REF_KM,
  EXPEDITION_DECAY_FLOOR,
  ARREAR_MORALE_PENALTY,
  FAMINE_TROOP_LOSS_RATE,
  INIT_TREASURY_UPKEEP_MULTIPLIER,
  INIT_TREASURY_FLOOR,
  INIT_GRANARY_UPKEEP_MULTIPLIER,
  INIT_GRANARY_FLOOR,
}

// ═══════════════════════════════════════
//  派生类型
// ═══════════════════════════════════════

/** 单势力单回合经济结算结果 */
export interface FactionEconomy {
  /** 税饷收入（万银） */
  silverTax: number
  /** 粮秣产出（万石） */
  foodProduce: number
  /** 养兵银支出（万银） */
  silverUpkeep: number
  /** 养兵粮支出（万石） */
  foodUpkeep: number
  /** 银净收入 = 税 - 养兵银（可为负） */
  silverNet: number
  /** 粮净收入 = 产 - 养兵粮（可为负） */
  foodNet: number
  /** 总兵力（k） */
  totalTroops: number
}

/** 动作成本查询结果 */
export interface ActionCost {
  silver: number
  food: number
}

// ═══════════════════════════════════════
//  远征消耗公式
// ═══════════════════════════════════════

/**
 * 行军一次性成本（银 + 粮）。纯函数。
 * @param distanceKm 行军距离（公里）
 * @param troopsK 行军兵力（千）
 */
export function marchCost(distanceKm: number, troopsK: number): ActionCost {
  return {
    silver: Math.round(distanceKm * troopsK * MARCH_SILVER_PER_KM_PER_K * 10) / 10,
    food: Math.round(distanceKm * troopsK * MARCH_FOOD_PER_KM_PER_K * 10) / 10,
  }
}

/**
 * 远征战力衰减系数。纯函数。
 * 近程无影响（因子 ≈ 1.0），远程逼近衰减下限。
 */
export function expeditionFactor(distanceKm: number): number {
  if (distanceKm <= 0) return 1.0
  return Math.max(EXPEDITION_DECAY_FLOOR, 1 - distanceKm / EXPEDITION_DECAY_REF_KM)
}

// ═══════════════════════════════════════
//  公式函数
// ═══════════════════════════════════════

/**
 * 计算单势力单回合经济结算（税收 - 养兵）。
 * 纯函数：传入城市表 + 势力，返回收支明细。
 */
export function computeFactionEconomy(
  cities: Record<string, CityState>,
  faction: Owner,
): FactionEconomy {
  let silverTax = 0
  let foodProduce = 0
  let totalTroops = 0

  for (const c of Object.values(cities)) {
    if (c.owner !== faction) continue
    silverTax += c.cityLevel * TAX_PER_CITY_LEVEL + c.industry * TAX_PER_INDUSTRY
    foodProduce += c.food * FOOD_PER_FOOD_POINT
    totalTroops += c.troops + c.fieldForce
  }

  const silverUpkeep = totalTroops * UPKEEP_SILVER_PER_K
  const foodUpkeep = totalTroops * UPKEEP_FOOD_PER_K

  return {
    silverTax: Math.round(silverTax * 10) / 10,
    foodProduce: Math.round(foodProduce * 10) / 10,
    silverUpkeep: Math.round(silverUpkeep * 10) / 10,
    foodUpkeep: Math.round(foodUpkeep * 10) / 10,
    silverNet: Math.round((silverTax - silverUpkeep) * 10) / 10,
    foodNet: Math.round((foodProduce - foodUpkeep) * 10) / 10,
    totalTroops,
  }
}

/**
 * 计算初始资金（开局灌溉用）。
 * 银库 = 养兵银 × INIT_TREASURY_UPKEEP_MULTIPLIER，下限 INIT_TREASURY_FLOOR。
 * 粮仓同理。
 */
export function computeInitialFunds(
  cities: Record<string, CityState>,
  faction: Owner,
): { treasury: number; granary: number } {
  const eco = computeFactionEconomy(cities, faction)
  const treasury = Math.max(
    INIT_TREASURY_FLOOR,
    Math.round(eco.silverUpkeep * INIT_TREASURY_UPKEEP_MULTIPLIER),
  )
  const granary = Math.max(
    INIT_GRANARY_FLOOR,
    Math.round(eco.foodUpkeep * INIT_GRANARY_UPKEEP_MULTIPLIER),
  )
  return { treasury, granary }
}

/**
 * 查询内政指令的一次性成本。
 * @param order 指令类型
 * @param amount 数量（征兵 k / 建设点 / 工事点；rally 忽略）
 * @returns { silver, food } 成本（万银 / 万石）
 */
export function computeActionCost(
  order: 'recruit' | 'develop' | 'fortify' | 'rally',
  amount: number,
): ActionCost {
  switch (order) {
    case 'recruit':
      return {
        silver: Math.round(amount * RECRUIT_SILVER_PER_K * 10) / 10,
        food: Math.round(amount * RECRUIT_FOOD_PER_K * 10) / 10,
      }
    case 'develop':
      return { silver: Math.round(amount * DEVELOP_SILVER_PER_POINT * 10) / 10, food: 0 }
    case 'fortify':
      return { silver: Math.round(amount * FORTIFY_SILVER_PER_POINT * 10) / 10, food: 0 }
    case 'rally':
      return { silver: RALLY_SILVER_FLAT, food: 0 }
  }
}
