/**
 * validateFactionOrder / validatePlayerOrder 战略校验单测
 * #4 改动：抽公共 validateOwnedOrder，新增政权版
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  validateFactionOrder,
  validateFactionOrders,
  validatePlayerOrder,
  validatePlayerOrders,
} from '../utils/aiOrderContract'
import { registerLocations, clearLocations } from '../utils/locationResolver'
import { Owner } from '../data/owners'
import type { GameOrder } from '../utils/gameOrders'

// ── 测试数据：3 个 mock 城市（成都=SCC, 北京=KMT, 杭州=KMT）──
const CHENGDU_GB = '156500001'
const BEIJING_GB = '110000001'
const HANGZHOU_GB = '156440101'

// ownership: 成都→SCC, 北京→KMT, 杭州→KMT
const ownership: Record<string, Owner> = {
  [CHENGDU_GB]: Owner.SCC,
  [BEIJING_GB]: Owner.KMT,
  [HANGZHOU_GB]: Owner.KMT,
}

const troops: Record<string, number> = {
  [CHENGDU_GB]: 20,
  [BEIJING_GB]: 30,
  [HANGZHOU_GB]: 15,
}

const cityOwner = (gb: string): Owner | undefined => ownership[gb]
const cityTroops = (gb: string): number | undefined => troops[gb]

beforeAll(() => {
  // 注册 3 个城市到 locationResolver，使 resolveLocationId('成都') 能解析
  clearLocations()
  const features: GeoJSON.Feature[] = [
    { type: 'Feature', properties: { name: '成都', gb: CHENGDU_GB }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: '北京', gb: BEIJING_GB }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: '杭州', gb: HANGZHOU_GB }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ] as unknown as GeoJSON.Feature[]
  registerLocations(features, 'gb')
})

// ── 1. 玩家版（回归测试：行为不变）──
describe('validatePlayerOrder（回归）', () => {
  it('未选势力时任何指令都被拒', () => {
    const r = validatePlayerOrder({ order: 'capture', gb: '北京', owner: Owner.KMT }, null, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('禁止指令 setFactionAlive 被拒', () => {
    const r = validatePlayerOrder({ order: 'setFactionAlive', faction: Owner.SHX, alive: false }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('capture：owner 错配被拒', () => {
    const r = validatePlayerOrder({ order: 'capture', gb: '北京', owner: Owner.JPN }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不匹配')
  })

  it('capture：己方城市被拒', () => {
    const r = validatePlayerOrder({ order: 'capture', gb: '成都', owner: Owner.SCC }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('已是')
  })

  it('moveTroops：amount 超过源城驻军被拒', () => {
    const r = validatePlayerOrder({ order: 'moveTroops', from: '成都', to: '成都', amount: 100 }, Owner.SCC, cityOwner, cityTroops)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('超过')
  })

  it('moveTroops：from 不是己方被拒', () => {
    const r = validatePlayerOrder({ order: 'moveTroops', from: '北京', to: '成都', amount: 5 }, Owner.SCC, cityOwner, cityTroops)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不属于')
  })

  it('合法 moveTroops 通过', () => {
    // 注意：moveTroops 的 to 必须己方，from 必须己方（都已是）；amount 5 ≤ 20
    const r = validatePlayerOrder({ order: 'moveTroops', from: '成都', to: '成都', amount: 5 }, Owner.SCC, cityOwner, cityTroops)
    expect(r.ok).toBe(true)
  })
})

// ── 2. 政权版（新增）──
describe('validateFactionOrder', () => {
  it('禁止指令 setCurrentDate 被拒', () => {
    const r = validateFactionOrder({ order: 'setCurrentDate', date: '1932-01-01' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('setCurrentDate')
  })

  it('禁止指令 setFactionAlive 被拒', () => {
    const r = validateFactionOrder({ order: 'setFactionAlive', faction: Owner.SHX, alive: false }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('禁止指令 setCurrentFaction 被拒', () => {
    const r = validateFactionOrder({ order: 'setCurrentFaction', faction: Owner.KMT }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('capture：actor 不匹配自身（被拒）—— LLM 写错 actor 的硬约束', () => {
    const r = validateFactionOrder({ order: 'capture', gb: '北京', owner: Owner.KMT }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不匹配')
  })

  it('capture：actor === 自身且非己方城（通过）', () => {
    const r = validateFactionOrder({ order: 'capture', gb: '北京', owner: Owner.SCC }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(true)
  })

  it('capture：actor === 自身但目标已是己方（被拒）', () => {
    const r = validateFactionOrder({ order: 'capture', gb: '成都', owner: Owner.SCC }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('已是')
  })

  it('battle：from 必须己方（被拒）', () => {
    const r = validateFactionOrder({ order: 'battle', from: '北京', to: '杭州' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不属于本方')
  })

  it('battle：to 不能是己方（被拒）—— 不能打自己人', () => {
    // SCC 出兵打自己的另一城（错误但常见 LLM 笔误）
    const r = validateFactionOrder({ order: 'battle', from: '成都', to: '成都' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('属于本方')
  })

  it('battle：合法 SCC→KMT 互攻（通过）', () => {
    const r = validateFactionOrder({ order: 'battle', from: '成都', to: '北京' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(true)
  })

  it('orbBurst：to 不能是己方（被拒）', () => {
    const r = validateFactionOrder({ order: 'orbBurst', from: '成都', to: '成都' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('moveTroops：from/to 都必须己方', () => {
    // from 不是己方
    const r1 = validateFactionOrder({ order: 'moveTroops', from: '北京', to: '成都', amount: 5 }, Owner.SCC, cityOwner, cityTroops)
    expect(r1.ok).toBe(false)
    // to 不是己方
    const r2 = validateFactionOrder({ order: 'moveTroops', from: '成都', to: '北京', amount: 5 }, Owner.SCC, cityOwner, cityTroops)
    expect(r2.ok).toBe(false)
  })

  it('moveTroops：合法己方内部调兵（通过）', () => {
    const r = validateFactionOrder({ order: 'moveTroops', from: '成都', to: '成都', amount: 5 }, Owner.SCC, cityOwner, cityTroops)
    expect(r.ok).toBe(true)
  })

  it('arrowFly：from 必须己方', () => {
    // 纯视觉动画，但仍校验 from
    const r = validateFactionOrder({ order: 'arrowFly', from: '北京', to: '杭州' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(false)
  })

  it('合法 arrowFly 通过', () => {
    const r = validateFactionOrder({ order: 'arrowFly', from: '成都', to: '北京' }, Owner.SCC, cityOwner)
    expect(r.ok).toBe(true)
  })

  it('radarPulse / fogCover / listBattles 等无 from/to 的指令默认可走（不校验归属）', () => {
    expect(validateFactionOrder({ order: 'radarPulse', from: '成都' }, Owner.SCC, cityOwner).ok).toBe(true)
    expect(validateFactionOrder({ order: 'fogCover' }, Owner.SCC, cityOwner).ok).toBe(true)
    expect(validateFactionOrder({ order: 'listBattles' }, Owner.SCC, cityOwner).ok).toBe(true)
  })
})

// ── 3. 批量版 ──
describe('validateFactionOrders', () => {
  it('混合：通过 + 被拒 分到两个列表', () => {
    const orders: GameOrder[] = [
      { order: 'capture', gb: '北京', owner: Owner.SCC }, // ✅ 合法
      { order: 'setCurrentDate', date: '1932-01-01' }, // ❌ 禁用
      { order: 'battle', from: '北京', to: '杭州' }, // ❌ from 不是己方
      { order: 'battle', from: '成都', to: '北京' }, // ✅ 合法
    ]
    const r = validateFactionOrders(orders, Owner.SCC, cityOwner, cityTroops)
    expect(r.approved.length).toBe(2)
    expect(r.rejected.length).toBe(2)
    expect(r.rejected[0].reason).toContain('setCurrentDate')
    expect(r.rejected[1].reason).toContain('不属于本方')
  })

  it('全拒时返回空 approved（不抛错）', () => {
    const orders: GameOrder[] = [
      { order: 'setCurrentDate', date: '1932-01-01' },
      { order: 'setFactionAlive', faction: Owner.SHX, alive: false },
    ]
    const r = validateFactionOrders(orders, Owner.SCC, cityOwner, cityTroops)
    expect(r.approved.length).toBe(0)
    expect(r.rejected.length).toBe(2)
  })
})

// ── 4. 玩家版批量回归 ──
describe('validatePlayerOrders（回归）', () => {
  it('玩家模式下 SCC 不可给 KMT capture（owner 错配）', () => {
    const r = validatePlayerOrders([{ order: 'capture', gb: '北京', owner: Owner.KMT }], Owner.SCC, cityOwner, cityTroops)
    expect(r.approved.length).toBe(0)
    expect(r.rejected.length).toBe(1)
  })

  it('玩家模式下 SCC 给自己 capture 北京（合法）', () => {
    const r = validatePlayerOrders([{ order: 'capture', gb: '北京', owner: Owner.SCC }], Owner.SCC, cityOwner, cityTroops)
    expect(r.approved.length).toBe(1)
  })
})
