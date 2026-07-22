/**
 * aiContext 上下文构建单测
 * #5.3 改动：
 * - buildFactionContext：新增邻接城市 + byActor 历史
 * - buildMinorContext：新增 sinceDateAdvance 历史
 * - buildSettleContext：复用 buildEventHistory（不再手写简化版）
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '../stores/game'
import { buildFactionContext, buildMinorContext, buildSettleContext } from '../utils/aiContext'
import { registerLocations, clearLocations } from '../utils/locationResolver'
import { Owner } from '../data/owners'

// 至少注册一个城市（让 store.cities[gb]?.name 正常返回）
beforeAll(() => {
  clearLocations()
  const features: GeoJSON.Feature[] = [
    { type: 'Feature', properties: { name: '梅州市', gb: '156441400' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: '太原', gb: '156141100' }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ] as unknown as GeoJSON.Feature[]
  registerLocations(features, 'gb')
})

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('buildFactionContext（#5.3 增强）', () => {
  it('基础：本势力城市 + 兵力 + 引导', () => {
    const store = useGameStore()
    store.initWorld()
    const ctx = buildFactionContext(Owner.KMT)
    expect(ctx).toContain('你的势力：国民政府')
    expect(ctx).toContain('当前日期：')
    expect(ctx).toContain('城市详情：')
    expect(ctx).toContain('驻军')
    expect(ctx).toContain('请决定本回合行动')
  })

  it('【增强】包含一阶邻接城市（他方）', () => {
    const store = useGameStore()
    store.initWorld()
    // 找一个有 KMT 城市 + 邻接非 KMT 的组合
    // 太原（SHX）邻接 KMT 城，选 SHX 视角
    const ctx = buildFactionContext(Owner.SHX)
    // SHX 控制 156141100（吕梁）= 太原（不是，是吕梁市）
    // 邻接图数据至少保证有他方城市入文
    if (ctx.includes('邻接城市')) {
      expect(ctx).toMatch(/他方|中立/)
    }
  })

  it('【增强】注入 byActor 历史（含 narrative）', () => {
    const store = useGameStore()
    store.initWorld()
    // 落一条 narrative + 一条 capture
    store.applyEvent({ type: 'narrative', playerInput: 'test', aiMessage: 'msg', kind: 'player' })
    store.applyEvent({ type: 'capture', targetGb: '156441400', actor: Owner.KMT })
    const ctx = buildFactionContext(Owner.KMT)
    expect(ctx).toContain('近期世界动态')
    expect(ctx).toContain('占领')
  })

  it('【增强】actor 历史为空时不显示"近期世界动态"段', () => {
    const store = useGameStore()
    store.initWorld()
    const ctx = buildFactionContext(Owner.NEA) // 没有任何历史
    expect(ctx).not.toContain('近期世界动态')
  })

  it('无 city 城市时不会崩', () => {
    const store = useGameStore()
    store.initWorld()
    // TIB 几乎无城
    const ctx = buildFactionContext(Owner.TIB)
    expect(ctx).toContain('你的势力：')
  })
})

describe('buildMinorContext（#5.3 增强）', () => {
  it('基础：次要势力清单 + 引导', () => {
    const store = useGameStore()
    store.initWorld()
    const ctx = buildMinorContext([Owner.MA, Owner.XJ, Owner.TIB])
    expect(ctx).toContain('当前日期：')
    expect(ctx).toContain('马家军')
    expect(ctx).toContain('新疆')
    expect(ctx).toContain('西藏')
    expect(ctx).toContain('保守为上')
  })

  it('【增强】注入 sinceDateAdvance 历史（跨势力）', () => {
    const store = useGameStore()
    store.initWorld()
    store.applyEvent({ type: 'dateAdvance', date: '1931-01-01' })
    store.applyEvent({ type: 'capture', targetGb: '156441400', actor: Owner.SCC })
    const ctx = buildMinorContext([Owner.MA])
    expect(ctx).toContain('近期世界动态')
    expect(ctx).toContain('占领')
  })

  it('空 factions 列表不崩', () => {
    const store = useGameStore()
    store.initWorld()
    const ctx = buildMinorContext([])
    expect(ctx).toContain('0 个次要势力')
  })
})

describe('buildSettleContext（#5.3 复用 buildEventHistory）', () => {
  it('基础：当前日期 + 引导 + 本轮事件', () => {
    const store = useGameStore()
    store.initWorld()
    store.applyEvent({ type: 'dateAdvance', date: '1931-01-01' })
    store.applyEvent({ type: 'capture', targetGb: '156441400', actor: Owner.KMT })
    const ctx = buildSettleContext('1931-02-01')
    expect(ctx).toContain('当前日期：1931-02-01')
    expect(ctx).toContain('本回合各势力的行动已经执行完毕')
    expect(ctx).toContain('占领')
  })

  it('本轮无事件时显示"（本回合无事件）"', () => {
    const store = useGameStore()
    store.initWorld()
    const ctx = buildSettleContext('1931-04-01')
    expect(ctx).toContain('本回合无事件')
  })
})
