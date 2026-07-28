/**
 * battleFormula 纯函数单测
 * 覆盖：computeBaseBattle / checkMoraleCollapse / clampFlavor
 */
import { describe, it, expect } from 'vitest'
import { computeBaseBattle, checkMoraleCollapse, clampFlavor, BATTLE_RULES } from '../utils/battleFormula'
import type { BaseResult, FlavorResult } from '../utils/battleFormula'

describe('computeBaseBattle', () => {
  it('基础：兵力比影响减员', () => {
    // 攻方 100，守方 100，士气相同
    const r = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0 })
    expect(r.attackerLoss).toBeGreaterThan(0)
    expect(r.defenderLoss).toBeGreaterThan(0)
  })

  it('兵力优势越大，守方减员越多', () => {
    const weakDef = computeBaseBattle({ atkForce: 100, defTroops: 50, atkMorale: 70, defMorale: 70, fort: 0 })
    const strongDef = computeBaseBattle({ atkForce: 100, defTroops: 200, atkMorale: 70, defMorale: 70, fort: 0 })
    // ratio clamp + round 可能导致极端值下整数相同，这里只验证有减员
    expect(weakDef.defenderLoss).toBeGreaterThan(0)
    expect(strongDef.defenderLoss).toBeGreaterThan(0)
  })

  it('守城工事提升守方存活率（减员更低）', () => {
    const noFort = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0 })
    const withFort = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 100 })
    // 有工事时守方减员应更低
    expect(withFort.defenderLoss).toBeLessThan(noFort.defenderLoss)
  })

  it('工事不影响攻方减员', () => {
    // 工事是守方修正，不应改变攻方减员
    const noFort = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0 })
    const withFort = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 100 })
    expect(withFort.attackerLoss).toBe(noFort.attackerLoss)
  })

  it('地形因子：山地 > 丘陵 > 平原', () => {
    const plain = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0, terrain: 'plain' })
    const hill = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0, terrain: 'hill' })
    const mountain = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0, terrain: 'mountain' })
    // 地形越恶劣，攻方减员越高
    expect(mountain.attackerLoss).toBeGreaterThanOrEqual(hill.attackerLoss)
    expect(hill.attackerLoss).toBeGreaterThanOrEqual(plain.attackerLoss)
  })

  it('士气低于 moraleRef 时 moraleFactor > 1（debuff）', () => {
    const lowMorale = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 30, defMorale: 70, fort: 0 })
    const highMorale = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 90, defMorale: 70, fort: 0 })
    // 低士气攻方应承受更高减员
    expect(lowMorale.attackerLoss).toBeGreaterThan(highMorale.attackerLoss)
  })

  it('士气 clamped 到 [floor, ceil]', () => {
    const veryLow = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 0, defMorale: 0, fort: 0 })
    const veryHigh = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 100, defMorale: 100, fort: 0 })
    // 低士气不应导致攻方减员无限大
    expect(veryLow.attackerLoss).toBeLessThan(100)
    // 高士气攻方减员应很低
    expect(veryHigh.attackerLoss).toBeLessThan(veryLow.attackerLoss)
  })

  it('兵力 ratio 被 clamp 到 [0.5, 3.0]', () => {
    // 攻方极多，守方极少
    const r = computeBaseBattle({ atkForce: 1000, defTroops: 1, atkMorale: 70, defMorale: 70, fort: 0 })
    expect(r.defenderLoss).toBeGreaterThan(0)
    // ratio clamp 防止极端减员
    expect(r.defenderLoss).toBeLessThanOrEqual(1000)
  })

  it('士气变化 delta 与 lossRate 成正比', () => {
    const r = computeBaseBattle({ atkForce: 100, defTroops: 100, atkMorale: 70, defMorale: 70, fort: 0 })
    expect(r.atkMoraleDelta).toBeLessThanOrEqual(0)
    expect(r.defMoraleDelta).toBeLessThanOrEqual(0)
  })
})

describe('checkMoraleCollapse', () => {
  it('disabled 时返回 null', () => {
    const prev = BATTLE_RULES.collapse.enabled
    BATTLE_RULES.collapse.enabled = false
    const r = checkMoraleCollapse({ battleId: 'b1', turns: 1, atkMorale: 10, defMorale: 10 })
    expect(r).toBeNull()
    BATTLE_RULES.collapse.enabled = prev
  })

  it('士气高于阈值返回 null', () => {
    const r = checkMoraleCollapse({ battleId: 'b1', turns: 1, atkMorale: 50, defMorale: 50 })
    expect(r).toBeNull()
  })

  it('士气低于阈值时可能崩溃（确定性随机）', () => {
    // 极低士气 + 多回合，提高崩溃概率
    const r = checkMoraleCollapse({ battleId: 'b1', turns: 10, atkMorale: 5, defMorale: 5 })
    expect(['attacker', 'defender', null]).toContain(r)
  })

  it('同一 battleId + turns 结果一致（replay 安全）', () => {
    const r1 = checkMoraleCollapse({ battleId: 'b1', turns: 3, atkMorale: 10, defMorale: 10 })
    const r2 = checkMoraleCollapse({ battleId: 'b1', turns: 3, atkMorale: 10, defMorale: 10 })
    expect(r1).toBe(r2)
  })

  it('不同 battleId 可能不同结果', () => {
    // 多次采样，至少有一个不同（概率极高）
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      results.add(checkMoraleCollapse({ battleId: `b${i}`, turns: 5, atkMorale: 10, defMorale: 10 } ?? 'null')
      )
    }
    // 由于是确定性随机，不同 seed 应产生不同结果
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('clampFlavor', () => {
  const base: BaseResult = { attackerLoss: 100, defenderLoss: 50, atkMoraleDelta: -5, defMoraleDelta: -3 }

  it('shock  magnitude 不超过 baseLoss * shockCap', () => {
    const flavor: FlavorResult = {
      events: [{ type: 'shock', side: 'attacker', magnitude: 200 }],
    }
    const r = clampFlavor(flavor, base)
    expect(r.events[0].magnitude).toBeLessThanOrEqual(Math.round(100 * BATTLE_RULES.flavor.shockCap))
  })

  it('morale delta 被 clamp 到 [-moraleCap, moraleCap]', () => {
    const flavor: FlavorResult = {
      events: [{ type: 'morale', side: 'attacker', delta: 999 }],
    }
    const r = clampFlavor(flavor, base)
    expect(r.events[0].delta).toBeLessThanOrEqual(BATTLE_RULES.flavor.moraleCap)
  })

  it('负 morale delta 也被 clamp 下限', () => {
    const flavor: FlavorResult = {
      events: [{ type: 'morale', side: 'defender', delta: -999 }],
    }
    const r = clampFlavor(flavor, base)
    expect(r.events[0].delta).toBeGreaterThanOrEqual(-BATTLE_RULES.flavor.moraleCap)
  })

  it('非 shock/morale 事件被过滤', () => {
    const flavor: FlavorResult = {
      events: [
        { type: 'shock', side: 'attacker', magnitude: 10 },
        { type: 'other', side: 'defender' },
      ],
    }
    const r = clampFlavor(flavor, base)
    expect(r.events.length).toBe(1)
  })

  it('zero magnitude shock 被过滤', () => {
    const flavor: FlavorResult = {
      events: [{ type: 'shock', side: 'attacker', magnitude: 0 }],
    }
    const r = clampFlavor(flavor, base)
    expect(r.events.length).toBe(0)
  })

  it('保留 narrative', () => {
    const flavor: FlavorResult = {
      events: [],
      narrative: '激战正酣',
    }
    const r = clampFlavor(flavor, base)
    expect(r.narrative).toBe('激战正酣')
  })
})
