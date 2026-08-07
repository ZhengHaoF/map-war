import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '@/stores/game'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import { Owner } from '@/data/owners'
import type { DiplomacyRecord } from '@/utils/diplomacy'
import { registerLocations } from '@/utils/locationResolver'
import seedCities from '@/data/chinaCities.seed.json'

describe('useDiplomacyBus / AI 主动发起外交 (AI-Initiated Diplomacy)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useGameStore()
    store.initWorld()
    store.selectFaction(Owner.SCC)
    const bus = useDiplomacyBus()
    bus.cancelDiplomacy()
  })

  it('AI 向玩家发起外交提案：正确创建 record、设置 currentSession 并进行持久化', () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()

    const playerFaction = store.currentFaction! // 'SCC'
    const aiFaction = Owner.SHX

    const record = bus.startAiDiplomacy(
      aiFaction,
      playerFaction,
      'peace',
      '阎锡山遣使致信求和，愿赔饷50万',
      [{ type: 'transferSilver', amount: 50 }],
    )

    expect(record).not.toBeNull()
    expect(record?.initiator).toBe(aiFaction)
    expect(record?.status).toBe('negotiating')
    expect(bus.currentSession.value?.id).toBe(record?.id)
    expect(store.diplomacyRecords).toContainEqual(expect.objectContaining({ id: record?.id }))
  })

  it('AI 对 AI 主动发起外交：静默改写关系，不占用 currentSession，记录设为 settled', () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()

    const record = bus.startAiDiplomacy(
      Owner.SHX,
      Owner.GXC,
      'alliance',
      '晋桂两系通电结盟',
    )

    expect(record).not.toBeNull()
    expect(record?.status).toBe('settled')
    // 不影响玩家当前的 currentSession
    expect(bus.currentSession.value).toBeNull()
    // 关系矩阵生效
    expect(store.relations['GXC-SHX']?.status).toBe('alliance')
  })

  it('玩家同意 AI 提案 (forceSettle)：履行条件并成功更新外交关系', async () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()

    const playerFaction = store.currentFaction!
    const aiFaction = Owner.SHX

    // 给予玩家和 AI 初始国库
    store.applyEvent({ type: 'treasuryChange', faction: playerFaction, delta: 100 })
    store.applyEvent({ type: 'treasuryChange', faction: aiFaction, delta: 100 })

    bus.startAiDiplomacy(
      aiFaction,
      playerFaction,
      'peace',
      '求和并赔款50万',
      [{ type: 'transferSilver', amount: 50 }],
    )

    // 假设 AI 赔饷给玩家，最后一轮 stance=accept 并收口
    const lastRound = bus.currentSession.value!.rounds[0]
    lastRound.stance = 'accept'

    const res = await bus.forceSettle()
    expect(res.narrative).toBeDefined()
    expect(bus.currentSession.value).toBeNull()
    // 关系更新为 peace
    expect(store.relations['SCC-SHX']?.status).toBe('peace')
  })

  it('玩家拒绝 AI 提案：记录归档且关系维持不变', async () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()

    const playerFaction = store.currentFaction!
    const aiFaction = Owner.SHX

    bus.startAiDiplomacy(
      aiFaction,
      playerFaction,
      'peace',
      '求和提案',
    )

    // 玩家拒绝
    const lastRound = bus.currentSession.value!.rounds[0]
    lastRound.stance = 'reject'

    await bus.forceSettle()
    expect(bus.currentSession.value).toBeNull()
    const record = store.diplomacyRecords.find((r) => r.id.startsWith('diplo_'))
    expect(record?.status).toBe('settled')
    expect(record?.finalStance).toBe('reject')
  })
})

describe('列强国家援助 (Country Aid via Envoy)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useGameStore()
    store.initWorld()
    store.selectFaction(Owner.SCC)
    const bus = useDiplomacyBus()
    bus.cancelDiplomacy()
    // 运行时由 LeafletMap 异步注册城市名 → gb；测试环境手动注册（军援 targetCity 解析依赖）
    const features = (seedCities as Array<{ gb: string; name: string }>).map((c) => ({
      type: 'Feature',
      properties: { gb: c.gb, name: c.name },
      geometry: null,
    })) as unknown as GeoJSON.Feature[]
    registerLocations(features, 'gb')
  })

  /** 造一个以苏联为目标、对方已 accept 的 negotiating 记录，捞回 session 后收口 */
  function seedSunSession(
    store: ReturnType<typeof useGameStore>,
    opts: {
      conditions?: DiplomacyRecord['rounds'][number]['conditions']
      aidOffer?: DiplomacyRecord['rounds'][number]['aidOffer']
    } = {},
  ): void {
    const record: DiplomacyRecord = {
      id: 'diplo_test_sun',
      playerFaction: Owner.SCC,
      targetCountry: 'SUN',
      intent: 'aid',
      rounds: [
        {
          round: 1,
          playerMessage: '川军求援，愿为苏方牵制奉军',
          stance: 'accept',
          reply: '斯大林应允，附援助清单',
          conditions: opts.conditions,
          aidOffer: opts.aidOffer,
        },
      ],
      status: 'negotiating',
      createdAt: store.currentDate,
    }
    store.upsertDiplomacyRecord(record)
    useDiplomacyBus().recoverSession()
  }

  function sccCity(store: ReturnType<typeof useGameStore>) {
    return Object.entries(store.cities).find(([, c]) => c.owner === Owner.SCC)![1]
  }

  function silverOf(store: ReturnType<typeof useGameStore>): number {
    return store.getSnapshot().factionTreasury[Owner.SCC] ?? 0
  }

  it('收口执行国家援助：财援/粮援/军援到账，条约 narrative 入 eventLog', async () => {
    const store = useGameStore()
    const bus = useDiplomacyBus()
    const city = sccCity(store)
    const beforeSilver = silverOf(store)
    const beforeFood = store.getSnapshot().factionGranary[Owner.SCC] ?? 0
    const beforeTroops = city.troops

    seedSunSession(store, {
      conditions: [{ type: 'verbal', text: '川军须允苏方在渝设厂' }],
      aidOffer: [
        { type: 'silver', amount: 30 },
        { type: 'food', amount: 20 },
        { type: 'military', amount: 5, targetCity: city.name },
      ],
    })
    expect(bus.currentSession.value?.targetCountry).toBe('SUN')

    await bus.forceSettle()

    // 援助到账
    expect(silverOf(store)).toBe(beforeSilver + 30)
    expect(store.getSnapshot().factionGranary[Owner.SCC] ?? 0).toBe(beforeFood + 20)
    expect(store.cities[city.gb].troops).toBe(beforeTroops + 5)
    // 条约 narrative 落 eventLog（供 AI 历史时间线读取）
    const narr = store.eventLog.find((e) => e.type === 'narrative' && e.kind === 'settlement')
    expect(narr).toBeDefined()
    expect((narr as { aiMessage?: string }).aiMessage).toContain('协定')
    // 记录归档 + session 清空
    expect(bus.currentSession.value).toBeNull()
    const rec = store.diplomacyRecords.find((r) => r.id === 'diplo_test_sun')
    expect(rec?.status).toBe('settled')
  })

  it('玩家偿付 transferSilver：扣玩家银，verbal 承诺不扣款', async () => {
    const store = useGameStore()
    const beforeSilver = silverOf(store)

    seedSunSession(store, {
      conditions: [
        { type: 'transferSilver', amount: 10 },
        { type: 'verbal', text: '川军须出兵牵制奉军' },
      ],
      aidOffer: [{ type: 'silver', amount: 30 }],
    })

    await useDiplomacyBus().forceSettle()

    expect(silverOf(store)).toBe(beforeSilver + 30 - 10)
  })

  it('军援目标城非玩家势力 → 条约作废：无援助到账、无条约 narrative', async () => {
    const store = useGameStore()
    const beforeSilver = silverOf(store)
    const otherCity = Object.entries(store.cities).find(([, c]) => c.owner !== Owner.SCC)![1]

    seedSunSession(store, {
      aidOffer: [{ type: 'military', amount: 5, targetCity: otherCity.name }],
    })

    await useDiplomacyBus().forceSettle()

    expect(silverOf(store)).toBe(beforeSilver)
    const narr = store.eventLog.find((e) => e.type === 'narrative' && e.kind === 'settlement')
    expect(narr).toBeUndefined()
    const rec = store.diplomacyRecords.find((r) => r.id === 'diplo_test_sun')
    expect(rec?.status).toBe('settled')
    expect(rec?.finalStance).toBe('accept')
  })
})
