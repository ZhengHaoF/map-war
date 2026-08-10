/**
 * milestones 谓词表单测
 * 覆盖：evaluateMilestones 返回本次新解锁 / 已解锁跳过 / 各 tier 谓词判定
 */
import { describe, it, expect } from 'vitest'
import { evaluateMilestones, MILESTONES, type MilestoneContext } from '../data/milestones'
import { Owner } from '../data/owners'

function baseCtx(over: Partial<MilestoneContext> = {}): MilestoneContext {
  return {
    faction: Owner.CCP,
    cityCount: 1,
    totalCities: 380,
    captures: 0,
    provinceOwned: {},
    troops: 0,
    morale: 50,
    treasury: 0,
    granary: 0,
    victories: 0,
    majorVictories: 0,
    bloodyVictories: 0,
    ...over,
  }
}

describe('evaluateMilestones', () => {
  it('新达成返回 id 列表，未达成返回空', () => {
    expect(evaluateMilestones(baseCtx({ captures: 5 }), {})).toContain('first-capture')
    expect(evaluateMilestones(baseCtx(), {})).toEqual([])
  })

  it('战斗类里程碑：胜绩初成 / 首胜会战 / 鏖战决胜', () => {
    expect(evaluateMilestones(baseCtx({ victories: 1 }), {})).toContain('first-victory')
    expect(evaluateMilestones(baseCtx({ majorVictories: 1 }), {})).toContain('first-major-victory')
    expect(evaluateMilestones(baseCtx({ bloodyVictories: 1 }), {})).toContain('bloody-battle')
  })

  it('已解锁的不重复返回', () => {
    const unlocked = { 'first-capture': { date: '1931-05-01', turn: 1 } }
    expect(evaluateMilestones(baseCtx({ captures: 20 }), unlocked)).not.toContain('first-capture')
  })

  it('captures 阈值：十城之基需 ≥10', () => {
    expect(evaluateMilestones(baseCtx({ captures: 9 }), {})).not.toContain('ten-cities')
    expect(evaluateMilestones(baseCtx({ captures: 10 }), {})).toContain('ten-cities')
  })

  it('兵力阈值：带甲十万需 troops ≥ 100', () => {
    expect(evaluateMilestones(baseCtx({ troops: 99 }), {})).not.toContain('army-100k')
    expect(evaluateMilestones(baseCtx({ troops: 100 }), {})).toContain('army-100k')
  })

  it('府库充盈需 treasury ≥ 500', () => {
    expect(evaluateMilestones(baseCtx({ treasury: 499 }), {})).not.toContain('rich-treasury')
    expect(evaluateMilestones(baseCtx({ treasury: 500 }), {})).toContain('rich-treasury')
  })

  it('收复东北需辽吉黑全省在握（依赖世界省表）', () => {
    const fullNE = baseCtx({
      provinceOwned: { '21': 100, '22': 100, '23': 100 },
    })
    expect(evaluateMilestones(fullNE, {})).toContain('northeast')
    // 只占两省不足
    const partialNE = baseCtx({ provinceOwned: { '21': 100, '22': 100 } })
    expect(evaluateMilestones(partialNE, {})).not.toContain('northeast')
  })

  it('比例类：雄踞一方 ≥25%，半壁江山 ≥50%', () => {
    expect(evaluateMilestones(baseCtx({ cityCount: 94 }), {})).not.toContain('quarter-realm')
    expect(evaluateMilestones(baseCtx({ cityCount: 95 }), {})).toContain('quarter-realm')
    expect(evaluateMilestones(baseCtx({ cityCount: 189 }), {})).not.toContain('half-realm')
    expect(evaluateMilestones(baseCtx({ cityCount: 190 }), {})).toContain('half-realm')
  })

  it('兵精粮足需兵力与粮仓同时达标', () => {
    expect(evaluateMilestones(baseCtx({ troops: 80, granary: 299 }), {})).not.toContain('well-supplied')
    expect(evaluateMilestones(baseCtx({ troops: 80, granary: 300 }), {})).toContain('well-supplied')
  })

  it('天下一统需 ≥95% 城池', () => {
    expect(evaluateMilestones(baseCtx({ cityCount: 360 }), {})).not.toContain('unification')
    expect(evaluateMilestones(baseCtx({ cityCount: 361 }), {})).toContain('unification')
  })

  it('MILESTONES 定义完整性：id 唯一、sealChar 单字、tier 合法', () => {
    const ids = new Set<string>()
    for (const m of MILESTONES) {
      expect(ids.has(m.id)).toBe(false)
      ids.add(m.id)
      expect(m.sealChar.length).toBe(1)
      expect([1, 2, 3]).toContain(m.tier)
    }
  })
})
