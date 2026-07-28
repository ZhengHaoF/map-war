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
 * 所有系数集中在本文件顶部常量区，改一个数全局生效。
 */

import type { CityState } from '@/stores/game'
import { Owner } from '@/data/owners'

// ═══════════════════════════════════════
//  收入公式系数
// ═══════════════════════════════════════

/** 每级城市规模贡献税饷（万银/回合） */
export const TAX_PER_CITY_LEVEL = 2
/** 每点工业贡献税饷（万银/回合） */
export const TAX_PER_INDUSTRY = 0.3
/** 每点粮食产能贡献粮秣（万石/回合） */
export const FOOD_PER_FOOD_POINT = 0.4

// ═══════════════════════════════════════
//  养兵消耗系数
// ═══════════════════════════════════════

/** 每千兵每回合银饷（万银/k/回合） */
export const UPKEEP_SILVER_PER_K = 0.5
/** 每千兵每回合粮秣（万石/k/回合） */
export const UPKEEP_FOOD_PER_K = 0.3

// ═══════════════════════════════════════
//  动作成本（一次性）
// ═══════════════════════════════════════

/** 征兵：每千兵银饷（万银/k） */
export const RECRUIT_SILVER_PER_K = 2
/** 征兵：每千兵粮秣（万石/k） */
export const RECRUIT_FOOD_PER_K = 1
/** 建设（develop）：每点工业/粮食的银两（万银/点） */
export const DEVELOP_SILVER_PER_POINT = 1.5
/** 筑防（fortify）：每点工事的银两（万银/点） */
export const FORTIFY_SILVER_PER_POINT = 1
/** 整军（rally）：固定银两（万银/次，不论士气增量大小） */
export const RALLY_SILVER_FLAT = 0.5

// ═══════════════════════════════════════
//  惩罚规则
// ═══════════════════════════════════════

/** 欠饷时全军士气惩罚（每回合） */
export const ARREAR_MORALE_PENALTY = -5
/** 缺粮时兵力损耗比例（每回合，如 0.02 = 2%） */
export const FAMINE_TROOP_LOSS_RATE = 0.02

// ═══════════════════════════════════════
//  初始资金
// ═══════════════════════════════════════

/** 初始银库 = 养兵银 × 此倍数（保证开局 N 回合不挨打） */
export const INIT_TREASURY_UPKEEP_MULTIPLIER = 8
/** 初始银库下限（万银，防止无兵势力为零） */
export const INIT_TREASURY_FLOOR = 100
/** 初始粮仓 = 养兵粮 × 此倍数 */
export const INIT_GRANARY_UPKEEP_MULTIPLIER = 8
/** 初始粮仓下限（万石） */
export const INIT_GRANARY_FLOOR = 50

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
