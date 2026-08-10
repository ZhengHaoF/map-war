/**
 * useGameScheduler 单胜奖励 + 150km 威慑扩散 全流程测试。
 *
 * 设计原则：
 *  - AI 调味层（flavorBattles）mock 为空，确保纯公式结算、无 LLM 依赖。
 *  - 断言值全部从 computeBaseBattle + 奖励/惩罚常量 **独立推导** 而来，
 *    而非反向回填实际输出——杜绝"代码没变 ≠ 代码正确"的陷阱。
 *  - 三座城市的 Polygon 几何体均在 registerLocations 注册，
 *    使 distanceBetween 返回有效距离，确保威慑扩散断言真正生效。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { Owner } from '@/data/owners'
import {
  BATTLE_VICTORY_MORALE_ATTACKER,
  BATTLE_VICTORY_MORALE_DEFENDER,
  BATTLE_DEFEAT_MORALE_ATTACKER,
  BATTLE_DETERRENT_MORALE,
} from '@/data/gameConfig'
import { registerLocations, distanceBetween } from '@/utils/locationResolver'
import { computeBaseBattle } from '@/utils/battleFormula'
import { expeditionFactor } from '@/utils/economy'

// Mock toast（测试环境无 DOM）
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: vi.fn() }),
}))

// Mock AI 调味层 — 消除 LLM 依赖，保证纯公式结算
vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn().mockResolvedValue({}),
}))

/** 生成以 (lng, lat) 为中心的微型 Polygon，供 calculateCentroid 使用 */
const makePoly = (lng: number, lat: number) => ({
  type: 'Polygon',
  coordinates: [[
    [lng - 0.01, lat - 0.01],
    [lng + 0.01, lat - 0.01],
    [lng + 0.01, lat + 0.01],
    [lng - 0.01, lat + 0.01],
    [lng - 0.01, lat - 0.01],
  ]],
})

/** 模拟 moraleChange reducer 的 clamp 行为 */
const clampMorale = (v: number) => Math.max(0, Math.min(100, v))

describe('useGameScheduler / 单胜奖励与 150km 威慑扩散', () => {
  // 注册三座城市的几何体，使 distanceBetween 可返回有效距离
  // 北京 ↔ 天津 ≈ 110km，天津 ↔ 廊坊 ≈ 65km，均 < 150km
  beforeEach(() => {
    setActivePinia(createPinia())
    registerLocations([
      { type: 'Feature', properties: { gb: '156110000', name: '北京' }, geometry: makePoly(116.4074, 39.9042) } as any,
      { type: 'Feature', properties: { gb: '156120000', name: '天津' }, geometry: makePoly(117.2009, 39.0842) } as any,
      { type: 'Feature', properties: { gb: '156131000', name: '廊坊' }, geometry: makePoly(116.7036, 39.5246) } as any,
    ], 'gb')
  })

  it('攻方胜 (capture)：攻方来源城 +10 士气，败方（NEA）周边 150km 友城 -5 士气', async () => {
    const store = useGameStore()
    store.initWorld()
    const { settleActiveBattles } = useGameScheduler()

    const fromGb = '156110000' // 北京 (KMT)
    const toGb = '156120000'   // 天津 → 设为 NEA
    const nearNeaGb = '156131000' // 廊坊 → 设为 NEA，距天津 ~65km < 150km

    // 显式设定阵营：天津 & 廊坊 归属 NEA（败方）
    store.cities[toGb] = { ...store.cities[toGb]!, owner: Owner.NEA }
    store.cities[nearNeaGb] = { ...store.cities[nearNeaGb]!, owner: Owner.NEA }

    const fromInitialMorale = store.cities[fromGb]!.morale
    const nearInitialMorale = store.cities[nearNeaGb]!.morale

    // 出兵 10k
    store.applyEvent({ type: 'deploy', fromGb, amount: 10 })

    store.applyEvent({
      type: 'battleStart',
      battleId: 'test_capture',
      fromGb,
      targetGb: toGb,
      fromName: '北京',
      toName: '天津',
      attacker: Owner.KMT,
      defender: Owner.NEA,
    })

    // 守军清零 → 即时占领，不经过战斗公式，无公式士气扣损
    store.cities[toGb] = { ...store.cities[toGb]!, troops: 0 }

    await settleActiveBattles()

    // 验证：攻方来源城获 +10 士气（无公式扣损，纯奖励）
    expect(store.cities[fromGb]?.morale).toBe(
      clampMorale(fromInitialMorale + BATTLE_VICTORY_MORALE_ATTACKER),
    )
    // 验证：败方（NEA）周边 150km 友城 -5 士气
    // 廊坊距天津 ~65km < 150km，应受威慑扩散
    expect(store.cities[nearNeaGb]?.morale).toBe(
      clampMorale(nearInitialMorale + BATTLE_DETERRENT_MORALE),
    )
  })

  it('守方胜 (attackerRouted)：守方城 +5 士气，攻方来源城 -10 士气，攻方周边 150km 友城 -5 士气', async () => {
    const store = useGameStore()
    store.initWorld()
    const { settleActiveBattles } = useGameScheduler()

    const fromGb = '156110000'    // 北京 (KMT)
    const toGb = '156120000'      // 天津 (NEA)
    const nearKmtGb = '156131000' // 廊坊 (KMT，距天津 ~65km < 150km)

    // 固定城市属性，便于独立推导预期值
    const M = 60 // 统一初始士气
    const defFort = 20
    const defTerrain = 'PLAIN'
    store.cities[fromGb] = { ...store.cities[fromGb]!, owner: Owner.KMT, morale: M }
    store.cities[toGb] = { ...store.cities[toGb]!, owner: Owner.NEA, morale: M, troops: 100, fort: defFort, terrain: defTerrain }
    store.cities[nearKmtGb] = { ...store.cities[nearKmtGb]!, owner: Owner.KMT, morale: M }

    // 出兵 1k — 被最低减员(1k) 一回合歼灭 → fieldForce 归零 → attackerRouted
    store.applyEvent({ type: 'deploy', fromGb, amount: 1 })

    // ── 独立推导预期值 ──
    // 用与 scheduler 完全相同的输入调用 computeBaseBattle，避免 magic number
    const dist = distanceBetween(fromGb, toGb)!
    const df = expeditionFactor(dist)
    const base = computeBaseBattle({
      atkForce: 1,
      defTroops: 100,
      atkMorale: M,
      defMorale: M,
      fort: defFort,
      terrain: defTerrain,
      distanceFactor: df,
    })

    // 预期：攻方 100% 损失 → atkMoraleDelta 约 -30；守方微损 → defMoraleDelta 约 -1
    // 攻方来源城：M + atkMoraleDelta（公式基础扣损）→ clamp → + DEFEAT（溃败打击 -10）→ clamp
    const expectedAtkMorale = clampMorale(clampMorale(M + base.atkMoraleDelta) + BATTLE_DEFEAT_MORALE_ATTACKER)
    // 守方城：M + defMoraleDelta（公式基础扣损）→ clamp → + VICTORY（单胜加成 +5）→ clamp
    const expectedDefMorale = clampMorale(clampMorale(M + base.defMoraleDelta) + BATTLE_VICTORY_MORALE_DEFENDER)

    store.applyEvent({
      type: 'battleStart',
      battleId: 'test_routed',
      fromGb,
      targetGb: toGb,
      fromName: '北京',
      toName: '天津',
      attacker: Owner.KMT,
      defender: Owner.NEA,
    })

    await settleActiveBattles()

    // 守方城：公式扣损 + 单胜加成 (+5)
    expect(store.cities[toGb]?.morale).toBe(expectedDefMorale)
    // 攻方来源城：公式扣损 + 溃败打击 (-10)
    expect(store.cities[fromGb]?.morale).toBe(expectedAtkMorale)
    // 攻方周边 150km KMT 友城 -5 士气（廊坊 ~65km < 150km）
    expect(store.cities[nearKmtGb]?.morale).toBe(clampMorale(M + BATTLE_DETERRENT_MORALE))
  })
})
