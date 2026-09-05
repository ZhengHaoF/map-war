/**
 * freeActionRules 翻译函数单测
 *
 * 验证自由行动 effect → 正规指令的翻译与钳制：
 * - produce → recruit（金额钳 FREE_CAP_PRODUCE）
 * - moveTroops → moveTroops（金额原样）
 * - cityStatChange 正向 → develop / fortify（钳 20；fort 走 fortify；cityLevel 丢弃）
 * - cityStatChange 负向 → null（走直通，幅度在 orchestrator 钳制）
 * - moraleChange 正向 → rally（钳 20）；负向 → null
 * - 其余类型（sendTelegram / relationChange / 银粮）→ null
 * - 非法城市 / 非法金额 → null
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { freeEffectToOrder } from '../utils/freeActionRules'
import { FREE_CAP_PRODUCE, FREE_CAP_CITY_STAT, FREE_CAP_MORALE_POS } from '@/data/gameConfig'

// locationResolver 依赖运行时注册的地点表，单测环境为空 → mock 为恒等函数
const { mockResolveLocationId } = vi.hoisted(() => ({ mockResolveLocationId: vi.fn() }))

vi.mock('../utils/locationResolver', () => ({
  resolveLocationId: (input: string) => mockResolveLocationId(input),
}))

const CITY = '111' // 任意有效编码（mock 恒等返回）
const INVALID = 'NOT_A_CITY' // mock 返回 null

beforeEach(() => {
  mockResolveLocationId.mockImplementation((s: string) => (s === INVALID ? null : s))
})

describe('freeEffectToOrder', () => {
  it('produce → recruit：金额钳制到 FREE_CAP_PRODUCE', () => {
    const order = freeEffectToOrder({ type: 'produce', targetGb: CITY, amount: 500 })
    expect(order).toEqual({ order: 'recruit', gb: CITY, amount: FREE_CAP_PRODUCE })
  })

  it('produce 金额为负/零/NaN → null（丢弃）', () => {
    expect(freeEffectToOrder({ type: 'produce', targetGb: CITY, amount: -5 })).toBeNull()
    expect(freeEffectToOrder({ type: 'produce', targetGb: CITY, amount: 0 })).toBeNull()
    expect(freeEffectToOrder({ type: 'produce', targetGb: CITY, amount: Number.NaN })).toBeNull()
  })

  it('produce 缺 targetGb → null', () => {
    expect(freeEffectToOrder({ type: 'produce', amount: 10 })).toBeNull()
  })

  it('非法城市编码 → null（丢弃）', () => {
    expect(freeEffectToOrder({ type: 'produce', targetGb: INVALID, amount: 10 })).toBeNull()
    expect(freeEffectToOrder({ type: 'moveTroops', fromGb: INVALID, toGb: CITY, amount: 5 })).toBeNull()
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: INVALID, field: 'industry', delta: 5 })).toBeNull()
  })

  it('moveTroops → moveTroops：金额原样保留（驻军上限由 validatePlayerOrder 校验）', () => {
    const order = freeEffectToOrder({ type: 'moveTroops', fromGb: '111', toGb: '112', amount: 30 })
    expect(order).toEqual({ order: 'moveTroops', from: '111', to: '112', amount: 30 })
  })

  it('cityStatChange 正向 industry/food → develop：金额钳 FREE_CAP_CITY_STAT', () => {
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: CITY, field: 'industry', delta: 50 })).toEqual({
      order: 'develop', gb: CITY, field: 'industry', amount: FREE_CAP_CITY_STAT,
    })
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: CITY, field: 'food', delta: 8 })).toEqual({
      order: 'develop', gb: CITY, field: 'food', amount: 8,
    })
  })

  it('cityStatChange 正向 fort → fortify', () => {
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: CITY, field: 'fort', delta: 15 })).toEqual({
      order: 'fortify', gb: CITY, amount: 15,
    })
  })

  it('cityStatChange 负向 → null（走直通，可对敌城破坏，幅度在 orchestrator 钳制）', () => {
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: CITY, field: 'industry', delta: -30 })).toBeNull()
  })

  it('cityStatChange field=cityLevel → null（城级不可经自由行动直接改）', () => {
    expect(freeEffectToOrder({ type: 'cityStatChange', targetGb: CITY, field: 'cityLevel', delta: 1 })).toBeNull()
  })

  it('moraleChange 正向 → rally：金额钳 FREE_CAP_MORALE_POS', () => {
    expect(freeEffectToOrder({ type: 'moraleChange', targetGb: CITY, delta: 60 })).toEqual({
      order: 'rally', gb: CITY, amount: FREE_CAP_MORALE_POS,
    })
    expect(freeEffectToOrder({ type: 'moraleChange', targetGb: CITY, delta: 5 })).toEqual({
      order: 'rally', gb: CITY, amount: 5,
    })
  })

  it('moraleChange 负向/零 → null（宣传/谣言走直通，可对敌城）', () => {
    expect(freeEffectToOrder({ type: 'moraleChange', targetGb: CITY, delta: -25 })).toBeNull()
    expect(freeEffectToOrder({ type: 'moraleChange', targetGb: CITY, delta: 0 })).toBeNull()
  })

  it('sendTelegram / relationChange / 银粮 → null（直通路径）', () => {
    expect(freeEffectToOrder({ type: 'sendTelegram', to: 'SHX', content: '你好' })).toBeNull()
    expect(freeEffectToOrder({ type: 'relationChange', a: 'KMT', b: 'SHX', status: 'war' })).toBeNull()
    expect(freeEffectToOrder({ type: 'treasuryChange', faction: 'KMT', delta: 30 })).toBeNull()
    expect(freeEffectToOrder({ type: 'granaryChange', faction: 'KMT', delta: 30 })).toBeNull()
  })
})
