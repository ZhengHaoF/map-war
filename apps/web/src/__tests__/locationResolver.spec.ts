/**
 * locationResolver 单测
 * 覆盖：registerLocations / clearLocations / resolveLocationId /
 *       resolveLocation / geoToScreen / registerAlias / registerNameAlias
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  clearLocations,
  registerLocations,
  registerAlias,
  registerNameAlias,
  resolveLocation,
  resolveLocationId,
  geoToScreen,
  setScreenSize,
  GEO_BOUNDS,
} from '../utils/locationResolver'

// mock getDisplayName（来自 @/data/displayNames）
vi.mock('@/data/displayNames', () => ({
  getDisplayName: (id: string) => {
    const map: Record<string, string> = {
      '156500001': '成都市',
      '156141100': '太原',
    }
    return map[id] ?? null
  },
}))

const makeFeature = (props: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  properties: props as any,
  geometry: { type: 'Point', coordinates: [0, 0] } as any,
})

beforeEach(() => {
  clearLocations()
  setScreenSize(1024, 768)
})

describe('registerLocations', () => {
  it('注册 feature 后可按 id 查找', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    expect(resolveLocation('156500001')).toBe(f)
  })

  it('注册后 name→id 可查', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    expect(resolveLocationId('成都')).toBe('156500001')
  })

  it('full_name 也注册为别名', () => {
    const f = makeFeature({ name: '苏联', full_name: '苏维埃社会主义共和国联盟', iso_a3: 'SUN' })
    registerLocations([f], 'iso_a3')
    expect(resolveLocationId('苏维埃社会主义共和国联盟')).toBe('SUN')
  })

  it('gb 编码城市自动注册历史地名', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    // getDisplayName('156500001') = '成都市'（见 mock）
    expect(resolveLocationId('成都市')).toBe('156500001')
  })

  it('id �� null/undefined 的 feature 被跳过', () => {
    const f1 = makeFeature({ name: '无名', gb: undefined as any })
    const f2 = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f1, f2], 'gb')
    expect(resolveLocationId('成都')).toBe('156500001')
  })

  it('同名不覆盖已注册 name→id', () => {
    const f1 = makeFeature({ name: '同名', gb: '111' })
    const f2 = makeFeature({ name: '同名', gb: '222' })
    registerLocations([f1], 'gb')
    registerLocations([f2], 'gb')
    expect(resolveLocationId('同名')).toBe('111')
  })
})

describe('clearLocations', () => {
  it('清空所有注册表', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    clearLocations()
    expect(resolveLocation('156500001')).toBeNull()
    expect(resolveLocationId('成都')).toBeNull()
  })
})

describe('resolveLocationId', () => {
  it('先查自然语言名，再查 id 直查', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    expect(resolveLocationId('成都')).toBe('156500001') // name 命中
    expect(resolveLocationId('156500001')).toBe('156500001') // id 直查
  })

  it('不存在的名称返回 null', () => {
    expect(resolveLocationId('不存在')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(resolveLocationId('')).toBeNull()
  })

  it('子串唯一匹配（如「咸阳」→「咸阳市」）', () => {
    const f = makeFeature({ name: '咸阳市', gb: '999' })
    registerLocations([f], 'gb')
    expect(resolveLocationId('咸阳')).toBe('999')
  })

  it('子串多义时返回 null', () => {
    const f1 = makeFeature({ name: '广州市', gb: '111' })
    const f2 = makeFeature({ name: '杭州市', gb: '222' })
    registerLocations([f1, f2], 'gb')
    expect(resolveLocationId('州')).toBeNull()
  })
})

describe('registerAlias / registerNameAlias', () => {
  it('registerAlias 让 fromId 映射到 toId 的 feature', () => {
    const f = makeFeature({ name: '苏联', iso_a3: 'SUN' })
    registerLocations([f], 'iso_a3')
    registerAlias('RUS', 'SUN')
    expect(resolveLocation('RUS')).toBe(f)
  })

  it('registerNameAlias 让 alias 可解析', () => {
    const f = makeFeature({ name: '成都', gb: '156500001' })
    registerLocations([f], 'gb')
    registerNameAlias('成都府', '156500001')
    expect(resolveLocationId('成都府')).toBe('156500001')
  })

  it('registerNameAlias 目标不存在时不注册', () => {
    registerNameAlias('不存在', '999999999')
    expect(resolveLocationId('不存在')).toBeNull()
  })
})

describe('geoToScreen', () => {
  it('默认尺寸下将经纬度映射到屏幕坐标', () => {
    const p = geoToScreen(104, 30)
    expect(p.x).toBeGreaterThan(0)
    expect(p.y).toBeGreaterThan(0)
  })

  it('自定义尺寸改变坐标范围', () => {
    const p1 = geoToScreen(104, 30, 800, 600)
    setScreenSize(800, 600)
    const p2 = geoToScreen(104, 30)
    expect(p1.x).toBeCloseTo(p2.x)
    expect(p1.y).toBeCloseTo(p2.y)
  })

  it('边界经纬度映射到边缘', () => {
    const left = geoToScreen(GEO_BOUNDS.minLng, 30)
    const right = geoToScreen(GEO_BOUNDS.maxLng, 30)
    expect(left.x).toBeLessThan(right.x)
    // 纬度越高 y 越小（屏幕坐标系）
    const top = geoToScreen(104, GEO_BOUNDS.maxLat)
    const bottom = geoToScreen(104, GEO_BOUNDS.minLat)
    expect(top.y).toBeLessThan(bottom.y)
  })
})
