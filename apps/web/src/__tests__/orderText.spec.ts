/**
 * orderText 纯函数单测
 * 覆盖：describeOrder
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { describeOrder } from '../utils/orderText'
import { registerLocations, clearLocations } from '../utils/locationResolver'
import { Owner } from '@/data/owners'

// mock getDisplayName
vi.mock('@/data/displayNames', () => ({
  getDisplayName: (id: string) => {
    const map: Record<string, string> = {
      '156500001': '成都市',
      '156141100': '太原',
    }
    return map[id] ?? null
  },
}))

beforeEach(() => {
  clearLocations()
  const features: GeoJSON.Feature[] = [
    { type: 'Feature', properties: { name: '成都', gb: '156500001' }, geometry: { type: 'Point', coordinates: [0, 0] } as any },
    { type: 'Feature', properties: { name: '太原', gb: '156141100' }, geometry: { type: 'Point', coordinates: [0, 0] } as any },
  ] as unknown as GeoJSON.Feature[]
  registerLocations(features, 'gb')
})

describe('describeOrder', () => {
  it('基础动词映射', () => {
    expect(describeOrder({ order: 'capture' } as any)).toBe('占领')
    expect(describeOrder({ order: 'moveTroops' } as any)).toBe('调兵')
    expect(describeOrder({ order: 'battle' } as any)).toBe('战斗')
  })

  it('unknown order 原样返回', () => {
    expect(describeOrder({ order: 'unknown' } as any)).toBe('unknown')
  })

  it('from + to + faction 拼接', () => {
    const r = describeOrder({ order: 'battle', from: '156500001', to: '156141100', faction: Owner.KMT } as any)
    expect(r).toBe('战斗 · 国民政府 成都市 → 太原')
  })

  it('gb 作为 to 的 fallback', () => {
    const r = describeOrder({ order: 'capture', gb: '156500001', faction: Owner.CCP } as any)
    expect(r).toBe('占领 · 中共苏区 · 成都市')
  })

  it('无 faction 不显示势力', () => {
    const r = describeOrder({ order: 'fogCover' } as any)
    expect(r).toBe('时移')
  })

  it('仅 from 无 to', () => {
    const r = describeOrder({ order: 'deploy', from: '156500001' } as any)
    expect(r).toBe('出兵 · 成都市')
  })

  it('仅 to 无 from', () => {
    const r = describeOrder({ order: 'rally', to: '156141100' } as any)
    expect(r).toBe('整军 · 太原')
  })

  it('历史地名映射（displayNames 优先）', () => {
    const r = describeOrder({ order: 'capture', gb: '156500001' } as any)
    expect(r).toContain('成都市')
  })

  it('GeoJSON name 兜底', () => {
    const r = describeOrder({ order: 'capture', gb: '156141100' } as any)
    expect(r).toContain('太原')
  })

  it('无任何 id 返回纯动词', () => {
    expect(describeOrder({ order: 'setCurrentDate' } as any)).toBe('推进日期')
  })
})
