/**
 * chronicle 纯函数层单测
 * 覆盖：buildExpansionTimeline（capture 归属到回合起始日期）/ provinceOf / countOwnedByProvince
 */
import { describe, it, expect } from 'vitest'
import { buildExpansionTimeline, provinceOf, countOwnedByProvince } from '../utils/chronicle'
import { Owner } from '../data/owners'
import type { GameEvent } from '../stores/game'

const events: GameEvent[] = [
  { type: 'dateAdvance', date: '1931-05-01' },
  { type: 'capture', targetGb: '156330100', actor: Owner.JPN }, // 浙江杭州 — 非玩家，忽略
  { type: 'capture', targetGb: '156110100', actor: Owner.CCP }, // 北平
  { type: 'dateAdvance', date: '1931-06-01' },
  { type: 'capture', targetGb: '156210100', actor: Owner.CCP }, // 沈阳
  { type: 'capture', targetGb: '156230100', actor: Owner.JPN }, // 哈尔滨 — 非玩家，忽略
  { type: 'dateAdvance', date: '1931-07-01' },
]

const cities = {
  '156110100': { name: '北平' },
  '156210100': { name: '沈阳' },
  '156330100': { name: '杭州' },
  '156230100': { name: '哈尔滨' },
}

describe('buildExpansionTimeline', () => {
  it('只统计 actor 为指定势力的 capture，且归入所在回合起始日期', () => {
    const tl = buildExpansionTimeline(events, Owner.CCP, cities)
    expect(tl).toEqual([
      { date: '1931-05-01', gb: '156110100', name: '北平' },
      { date: '1931-06-01', gb: '156210100', name: '沈阳' },
    ])
  })

  it('无任何 dateAdvance 时用开局日期兜底', () => {
    const tl = buildExpansionTimeline(
      [{ type: 'capture', targetGb: '156110100', actor: Owner.CCP } as GameEvent],
      Owner.CCP,
      cities,
    )
    expect(tl[0].date).toBe('1931-04-01')
  })

  it('无玩家 capture 返回空数组', () => {
    const tl = buildExpansionTimeline(events, Owner.KMT, cities)
    expect(tl).toEqual([])
  })

  it('未知 gb 用原始编码兜底为名称', () => {
    const tl = buildExpansionTimeline(
      [{ type: 'dateAdvance', date: '1931-05-01' }, { type: 'capture', targetGb: '999', actor: Owner.CCP }],
      Owner.CCP,
      cities,
    )
    expect(tl[0].name).toBe('999')
  })
})

describe('provinceOf', () => {
  it('解析 GB 编码第 4-5 位为省码', () => {
    expect(provinceOf('156420700')).toBe('42')
    expect(provinceOf('156210100')).toBe('21')
  })

  it('非 156 前缀或长度不足返回 null', () => {
    expect(provinceOf('42')).toBeNull()
    expect(provinceOf('999420700')).toBeNull()
  })
})

describe('countOwnedByProvince', () => {
  it('按省码聚合我方占有城数', () => {
    const ownership = {
      '156210100': Owner.CCP,
      '156220100': Owner.CCP,
      '156230100': Owner.JPN,
      '156110100': Owner.CCP,
    }
    expect(countOwnedByProvince(ownership, Owner.CCP)).toEqual({ '21': 1, '22': 1, '11': 1 })
  })

  it('非 156 前缀的城市不计入', () => {
    const ownership = { '42': Owner.CCP }
    expect(countOwnedByProvince(ownership, Owner.CCP)).toEqual({})
  })
})
