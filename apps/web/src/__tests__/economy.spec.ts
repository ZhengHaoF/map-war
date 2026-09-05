/**
 * economy 公式单测（补充）
 *
 * 重点验证 rally（整军）改为按量计费：
 * - 成本 = RALLY_SILVER_FLAT + |amount| × RALLY_SILVER_PER_POINT
 * - 原有 recruit / develop / fortify 成本不变
 */
import { describe, it, expect } from 'vitest'
import { computeActionCost, computeFactionEconomy, industryTaxContribution } from '../utils/economy'
import { RALLY_SILVER_FLAT, RALLY_SILVER_PER_POINT, TAX_PER_INDUSTRY, TAX_INDUSTRY_LINEAR_CAP } from '@/data/gameConfig'
import { Owner } from '@/data/owners'

describe('computeActionCost: rally 按量计费', () => {
  it('rally 成本随增量线性增长（防“0.5 万银拉满士气”）', () => {
    expect(computeActionCost('rally', 10)).toEqual({
      silver: RALLY_SILVER_FLAT + 10 * RALLY_SILVER_PER_POINT,
      food: 0,
    })
    expect(computeActionCost('rally', 99).silver).toBeGreaterThan(computeActionCost('rally', 10).silver)
  })

  it('rally 负增量按绝对值计费', () => {
    expect(computeActionCost('rally', -10)).toEqual(computeActionCost('rally', 10))
  })
})

describe('computeActionCost: 其余指令成本不变', () => {
  it('recruit 仍按量计费', () => {
    const c = computeActionCost('recruit', 5)
    expect(c.silver).toBeGreaterThan(0)
    expect(c.food).toBeGreaterThan(0)
  })

  it('develop / fortify 仅耗银', () => {
    expect(computeActionCost('develop', 5).food).toBe(0)
    expect(computeActionCost('fortify', 5).food).toBe(0)
  })
})

describe('industryTaxContribution（工业税凹曲线）', () => {
  it('种子基准以下全额：0 / 10 与线性一致', () => {
    expect(industryTaxContribution(0)).toBe(0)
    expect(industryTaxContribution(10)).toBe(10 * TAX_PER_INDUSTRY)
    expect(industryTaxContribution(TAX_INDUSTRY_LINEAR_CAP)).toBe(TAX_INDUSTRY_LINEAR_CAP * TAX_PER_INDUSTRY)
  })

  it('超过阈值后每点减半（回本周期翻倍）', () => {
    const oneBeyond = industryTaxContribution(TAX_INDUSTRY_LINEAR_CAP + 1)
    const atCap = industryTaxContribution(TAX_INDUSTRY_LINEAR_CAP)
    expect(oneBeyond - atCap).toBeCloseTo(TAX_PER_INDUSTRY * 0.5)
  })

  it('高工业城仍是巨无霸但被适度压缩', () => {
    // 上海 industry=100：线性 30 → 曲线 4.5 + 85×0.15 = 17.25
    expect(industryTaxContribution(100)).toBeCloseTo(17.25, 2)
    expect(industryTaxContribution(100)).toBeLessThan(100 * TAX_PER_INDUSTRY)
  })
})

describe('computeFactionEconomy', () => {
  it('空城市表返回全零', () => {
    const eco = computeFactionEconomy({}, Owner.KMT)
    expect(eco.silverNet).toBe(0)
    expect(eco.totalTroops).toBe(0)
  })
})
