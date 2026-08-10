import { describe, it, expect } from 'vitest'
import { battleTrend, battleForceShare, battleSummaryText } from '../utils/battleTrend'

// ── battleTrend ──

describe('battleTrend', () => {
  const make = (over: Partial<{ turns: number; totalAttackerLoss: number; totalDefenderLoss: number; lastAttackerLoss: number; lastDefenderLoss: number }> = {}) => ({
    turns: 0, totalAttackerLoss: 0, totalDefenderLoss: 0, lastAttackerLoss: 0, lastDefenderLoss: 0, ...over,
  })

  describe('basis=lastTurn（默认，地图面板同口径）', () => {
    it('turns=0 → 初次交锋', () => {
      expect(battleTrend(make(), 'lastTurn')).toEqual({ label: '初次交锋', cls: 'trend-even' })
      expect(battleTrend(make(), 'total')).toEqual({ label: '初次交锋', cls: 'trend-even' })
    })

    it('攻方损耗明显低于守方（< 0.7倍）→ 攻方占优', () => {
      const b = make({ turns: 3, lastAttackerLoss: 0.5, lastDefenderLoss: 1.0 })
      expect(battleTrend(b, 'lastTurn')).toEqual({ label: '▲ 攻方占优', cls: 'trend-atk' })
    })

    it('守方损耗明显低于攻方（< 0.7倍）→ 守方占优', () => {
      const b = make({ turns: 3, lastAttackerLoss: 1.5, lastDefenderLoss: 0.3 })
      expect(battleTrend(b, 'lastTurn')).toEqual({ label: '▼ 守方占优', cls: 'trend-def' })
    })

    it('双方损耗接近 → 僵持', () => {
      const b = make({ turns: 3, lastAttackerLoss: 1.0, lastDefenderLoss: 1.1 })
      expect(battleTrend(b, 'lastTurn')).toEqual({ label: '— 僵持', cls: 'trend-even' })
    })

    it('阈值边界：a=0.7d 刚好不到 0.7 倍 → 僵持', () => {
      const b = make({ turns: 2, lastAttackerLoss: 0.7, lastDefenderLoss: 1.0 })
      // 0.7 < 1.0 * 0.7 = 0.7 → 不满足 < ，僵持
      expect(battleTrend(b, 'lastTurn').cls).toBe('trend-even')
    })

    it('阈值边界：a=0.69 刚好 < 0.7 → 攻方占优', () => {
      const b = make({ turns: 2, lastAttackerLoss: 0.69, lastDefenderLoss: 1.0 })
      expect(battleTrend(b, 'lastTurn').cls).toBe('trend-atk')
    })
  })

  describe('basis=total（AI prompt 同口径，阈值 1.2）', () => {
    it('累计攻方损耗远超守方（> 1.2倍）→ 守方占优', () => {
      const b = make({ turns: 5, totalAttackerLoss: 6.0, totalDefenderLoss: 3.0 })
      expect(battleTrend(b, 'total')).toEqual({ label: '▼ 守方占优', cls: 'trend-def' })
    })

    it('累计守方损耗远超攻方（> 1.2倍）→ 攻方占优', () => {
      const b = make({ turns: 5, totalAttackerLoss: 2.0, totalDefenderLoss: 5.0 })
      expect(battleTrend(b, 'total')).toEqual({ label: '▲ 攻方占优', cls: 'trend-atk' })
    })

    it('累计比 1:1.15 → 僵持', () => {
      const b = make({ turns: 5, totalAttackerLoss: 5.0, totalDefenderLoss: 5.75 })
      expect(battleTrend(b, 'total')).toEqual({ label: '— 僵持', cls: 'trend-even' })
    })
  })

  it('basis 默认值为 lastTurn', () => {
    const b = make({ turns: 2, lastAttackerLoss: 0.3, lastDefenderLoss: 1.0, totalAttackerLoss: 5.0, totalDefenderLoss: 5.0 })
    expect(battleTrend(b)).toEqual(battleTrend(b, 'lastTurn'))
  })
})

// ── battleForceShare ──

describe('battleForceShare', () => {
  it('双方零 → 50', () => {
    expect(battleForceShare(0, 0)).toBe(50)
  })

  it('纯攻方 → 钳制到 96', () => {
    expect(battleForceShare(100, 0)).toBe(96)
  })

  it('纯守方 → 钳制到 4', () => {
    expect(battleForceShare(0, 100)).toBe(4)
  })

  it('攻 30 守 70 → 30', () => {
    expect(battleForceShare(30, 70)).toBe(30)
  })

  it('攻 60 守 40 → 60', () => {
    expect(battleForceShare(60, 40)).toBe(60)
  })

  it('攻 50.4 守 49.6 → 四舍五入 50', () => {
    expect(battleForceShare(50.4, 49.6)).toBe(50)
  })
})

// ── battleSummaryText ──

describe('battleSummaryText', () => {
  it('正常数字 → 正确格式', () => {
    expect(battleSummaryText({ turns: 3, totalAttackerLoss: 2.4, totalDefenderLoss: 5.1, lastAttackerLoss: 0.8, lastDefenderLoss: 1.9 }))
      .toBe('攻损 2.4k / 守损 5.1k · 共 3 回合')
  })

  it('整数也正常显示', () => {
    expect(battleSummaryText({ turns: 1, totalAttackerLoss: 0, totalDefenderLoss: 3, lastAttackerLoss: 0, lastDefenderLoss: 3 }))
      .toBe('攻损 0k / 守损 3k · 共 1 回合')
  })
})
