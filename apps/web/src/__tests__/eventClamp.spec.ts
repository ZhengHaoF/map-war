/**
 * eventClamp 钳制函数单测
 *
 * 验证 reducer 级宽松兜底：
 * - 各事件类型的数值钳制边界
 * - NaN/Infinity 落到安全方向
 * - 幂等性（多次钳制结果恒等 → replay 安全）
 * - 不匹配类型原样返回
 */
import { describe, it, expect } from 'vitest'
import { clampEventMagnitude } from '../utils/eventClamp'
import { Owner } from '@/data/owners'
import type { GameEvent } from '@/stores/game'

describe('clampEventMagnitude', () => {
  it('treasuryChange：超限正负值收敛到 ±REDUCER_CAP_TREASURY', () => {
    expect(clampEventMagnitude({ type: 'treasuryChange', faction: Owner.KMT, delta: 5000 })).toEqual({
      type: 'treasuryChange', faction: Owner.KMT, delta: 500,
    })
    expect(clampEventMagnitude({ type: 'treasuryChange', faction: Owner.KMT, delta: -800 })).toEqual({
      type: 'treasuryChange', faction: Owner.KMT, delta: -500,
    })
  })

  it('treasuryChange：界内值保持不变', () => {
    expect(clampEventMagnitude({ type: 'treasuryChange', faction: Owner.KMT, delta: 100 })).toEqual({
      type: 'treasuryChange', faction: Owner.KMT, delta: 100,
    })
  })

  it('granaryChange：超限值收敛到 ±500', () => {
    expect(clampEventMagnitude({ type: 'granaryChange', faction: Owner.SHX, delta: 999 })).toEqual({
      type: 'granaryChange', faction: Owner.SHX, delta: 500,
    })
  })

  it('produce：负数/NaN 归零，超限收敛到 100', () => {
    expect(clampEventMagnitude({ type: 'produce', targetGb: '111', amount: 500 })).toEqual({
      type: 'produce', targetGb: '111', amount: 100,
    })
    expect(clampEventMagnitude({ type: 'produce', targetGb: '111', amount: -50 })).toEqual({
      type: 'produce', targetGb: '111', amount: 0,
    })
  })

  it('cityStatChange：超限值收敛到 ±100', () => {
    expect(clampEventMagnitude({ type: 'cityStatChange', targetGb: '111', field: 'fort', delta: 500 })).toEqual({
      type: 'cityStatChange', targetGb: '111', field: 'fort', delta: 100,
    })
  })

  it('moraleChange：超限值收敛到 ±50（胜利奖励 ±10/调味 ±20 不受影响）', () => {
    expect(clampEventMagnitude({ type: 'moraleChange', targetGb: '111', delta: 99 })).toEqual({
      type: 'moraleChange', targetGb: '111', delta: 50,
    })
    expect(clampEventMagnitude({ type: 'moraleChange', targetGb: '111', delta: -80 })).toEqual({
      type: 'moraleChange', targetGb: '111', delta: -50,
    })
    // 正常小值原样保留
    expect(clampEventMagnitude({ type: 'moraleChange', targetGb: '111', delta: 12 })).toEqual({
      type: 'moraleChange', targetGb: '111', delta: 12,
    })
  })

  it('NaN/Infinity：落到安全方向（负值下限或 0）', () => {
    const t: GameEvent = { type: 'treasuryChange', faction: Owner.KMT, delta: Number.NaN }
    const clampedT = clampEventMagnitude(t)
    expect(clampedT.type === 'treasuryChange' ? clampedT.delta : -1).toBe(-500)
    const prod: GameEvent = { type: 'produce', targetGb: '111', amount: Number.POSITIVE_INFINITY }
    const clamped = clampEventMagnitude(prod)
    expect(clamped.type === 'produce' ? clamped.amount : -1).toBe(0)
  })

  it('幂等：clamp(clamp(e)) === clamp(e)（replay 安全的前提）', () => {
    const e: GameEvent = { type: 'treasuryChange', faction: Owner.KMT, delta: 900 }
    const once = clampEventMagnitude(e)
    expect(clampEventMagnitude(once)).toEqual(once)
  })

  it('不匹配类型原样返回（同一引用）', () => {
    const e: GameEvent = { type: 'dateAdvance', date: '1931-09-18' }
    expect(clampEventMagnitude(e)).toBe(e)
  })
})
