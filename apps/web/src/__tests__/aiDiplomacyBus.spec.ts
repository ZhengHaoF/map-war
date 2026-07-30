import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGameStore } from '@/stores/game'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import { Owner } from '@/data/owners'

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
