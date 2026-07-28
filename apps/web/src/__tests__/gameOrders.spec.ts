/**
 * gameOrders 指令执行层单测
 *
 * 策略：mock 动画层（troopAnimation / cloudTransition）与 store / toast，
 * 只测 executeOrder 的分发、参数校验、世界态写回、锁与降级。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { executeOrder, resetBattleRuntime, ORDER_TYPES, init } from '../utils/gameOrders'
import { Owner } from '@/data/owners'

// ── 使用 vi.hoisted 避免提升顺序问题 ──
const { mockArrowFly, mockRadarPulse, mockOrbBurst, mockStartBattleAnimation, mockCaptureAnimation, mockDevelopAnimation, mockPlayCloudTransition } =
  vi.hoisted(() => ({
    mockArrowFly: vi.fn(),
    mockRadarPulse: vi.fn(),
    mockOrbBurst: vi.fn(),
    mockStartBattleAnimation: vi.fn(),
    mockCaptureAnimation: vi.fn(),
    mockDevelopAnimation: vi.fn(),
    mockPlayCloudTransition: vi.fn(),
  }))

vi.mock('../utils/troopAnimation', () => ({
  playArcAnimation: mockArrowFly,
  playScoutAnimation: mockRadarPulse,
  startBattleAnimation: mockStartBattleAnimation,
  playCaptureAnimation: mockCaptureAnimation,
  playDevelopAnimation: mockDevelopAnimation,
}))

vi.mock('../utils/cloudTransition', () => ({
  playCloudTransition: mockPlayCloudTransition,
}))

// ── Mock store ──
const mockApplyEvent = vi.fn(() => ({ ok: true }))
const mockSelectFaction = vi.fn()
const mockCities: Record<string, any> = {}
const mockBattles: any[] = []

function makeCity(gb: string, owner: Owner, troops = 10, fieldForce = 5, fort = 0): any {
  return { gb, owner, troops, fieldForce, fort, name: gb }
}

const mockStore = {
  cities: mockCities,
  battles: mockBattles,
  applyEvent: mockApplyEvent,
  selectFaction: mockSelectFaction,
  getSnapshot: () => ({}),
  getTreasury: () => 99999,
  getGranary: () => 99999,
  DEVELOP_FIELDS: ['industry', 'food', 'fort', 'cityLevel'],
}

vi.mock('@/stores/game', () => {
  const store = () => mockStore
  ;(store as any).DEVELOP_FIELDS = ['industry', 'food', 'fort', 'cityLevel']
  return { useGameStore: store, DEVELOP_FIELDS: (store as any).DEVELOP_FIELDS }
})

// ── Mock toast ──
const mockPush = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: mockPush }),
}))

// ── Mock locationResolver ──
const mockResolveLocationId = vi.fn((id: string): string | null => id)
vi.mock('../utils/locationResolver', () => ({
  resolveLocationId: (id: string) => mockResolveLocationId(id),
}))

// ── Mock displayNames ──
vi.mock('@/data/displayNames', () => ({
  getDisplayName: (id: string) => `城市_${id}`,
}))

beforeEach(() => {
  resetBattleRuntime()
  // 注入 mock PixiJS 依赖，使动画函数可执行
  init({} as any, {
    snapshot: () => ({ scale: 1, x: 0, y: 0 }),
    setLocked: () => {},
    focusOn: vi.fn().mockResolvedValue(undefined),
    followTo: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
  } as any, {} as any)

  mockApplyEvent.mockReset()
  mockSelectFaction.mockReset()
  mockPush.mockReset()
  mockResolveLocationId.mockReset()
  mockArrowFly.mockReset()
  mockRadarPulse.mockReset()
  mockOrbBurst.mockReset()
  mockStartBattleAnimation.mockReset()
  mockCaptureAnimation.mockReset()
  mockDevelopAnimation.mockReset()
  mockPlayCloudTransition.mockReset()

  // 默认城市数据：两个 KMT 城
  Object.keys(mockCities).forEach((k) => delete mockCities[k])
  mockBattles.length = 0
  mockCities['111'] = makeCity('111', Owner.KMT, 20, 10, 5)
  mockCities['222'] = makeCity('222', Owner.KMT, 15, 5, 0)
  mockCities['333'] = makeCity('333', Owner.NEA, 10, 0, 3)

  // 默认 resolveLocationId 原样返回（城市存在）
  mockResolveLocationId.mockImplementation((id: string) => id)
})

describe('executeOrder 基础', () => {
  it('缺少 order 字段返回错误', async () => {
    const r = await executeOrder({} as any)
    expect(r).toEqual({ ok: false, reason: '缺少 order 字段' })
  })

  it('未知指令返回错误', async () => {
    const r = await executeOrder({ order: 'unknown' } as any)
    expect(r).toEqual({ ok: false, reason: '未知指令: unknown' })
  })
})

describe('executeOrder 世界态写回指令', () => {
  it('capture：城市不存在返回错误', async () => {
    mockResolveLocationId.mockReturnValue(null)
    const r = await executeOrder({ order: 'capture', gb: '999', owner: Owner.KMT } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('目标城市不存在')
  })

  it('capture：合法路径播动画 + applyEvent', async () => {
    mockCaptureAnimation.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'capture', gb: '333', owner: Owner.KMT, resultTroops: 8 } as any)
    expect(r.ok).toBe(true)
    expect(mockCaptureAnimation).toHaveBeenCalledTimes(1)
    expect(mockApplyEvent).toHaveBeenCalledWith({
      type: 'capture',
      targetGb: '333',
      actor: Owner.KMT,
      resultTroops: 8,
    })
  })

  it('moveTroops：from/to 不存在返回错误', async () => {
    mockResolveLocationId.mockImplementation((id: string) => (id === '111' ? '111' : null))
    const r = await executeOrder({ order: 'moveTroops', from: '111', to: '999', amount: 5 } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('目标城市不存在')
  })

  it('moveTroops：amount <= 0 返回错误', async () => {
    const r = await executeOrder({ order: 'moveTroops', from: '111', to: '222', amount: 0 } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('amount 必须是正数')
  })

  it('moveTroops：合法路径播动画 + applyEvent', async () => {
    mockArrowFly.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'moveTroops', from: '111', to: '222', amount: 3 } as any)
    expect(r.ok).toBe(true)
    // arrowFly 内部调用 playArcAnimation（被 mock 为 mockArrowFly），参数是动画配置对象
    expect(mockArrowFly).toHaveBeenCalledTimes(1)
    const arcArgs = mockArrowFly.mock.calls[0][0]
    expect(arcArgs).toMatchObject({ fromId: '111', toId: '222', text: '调兵！', mode: 'dots' })
    expect(mockApplyEvent).toHaveBeenCalledWith({
      type: 'moveTroops',
      fromGb: '111',
      toGb: '222',
      amount: 3,
    })
  })

  it('deploy：合法路径 applyEvent', async () => {
    const r = await executeOrder({ order: 'deploy', from: '111', amount: 5 } as any)
    expect(r.ok).toBe(true)
    expect(mockApplyEvent).toHaveBeenCalledWith({ type: 'deploy', fromGb: '111', amount: 5 })
  })

  it('reinforce：side 非法返回错误', async () => {
    const r = await executeOrder({ order: 'reinforce', gb: '111', amount: 3, side: 'bad' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('side 必须是')
  })

  it('setFactionAlive：直接 applyEvent', async () => {
    const r = await executeOrder({ order: 'setFactionAlive', faction: Owner.SHX, alive: false } as any)
    expect(r.ok).toBe(true)
    expect(mockApplyEvent).toHaveBeenCalledWith({ type: 'setFactionAlive', faction: Owner.SHX, alive: false })
  })

  it('setCurrentDate：直接 applyEvent', async () => {
    const r = await executeOrder({ order: 'setCurrentDate', date: '1932-01-01' } as any)
    expect(r.ok).toBe(true)
    expect(mockApplyEvent).toHaveBeenCalledWith({ type: 'dateAdvance', date: '1932-01-01' })
  })

  it('setCurrentFaction：调用 selectFaction', async () => {
    const r = await executeOrder({ order: 'setCurrentFaction', faction: Owner.CCP } as any)
    expect(r.ok).toBe(true)
    expect(mockSelectFaction).toHaveBeenCalledWith(Owner.CCP)
  })
})

describe('executeOrder 战斗指令', () => {
  it('battle：from/to 不存在返回错误', async () => {
    mockResolveLocationId.mockImplementation((id: string) => (id === '111' ? '111' : null))
    const r = await executeOrder({ order: 'battle', from: '111', to: '999' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('B 方城市不存在')
  })

  it('battle：来源城无可战之兵（fieldForce <= 0）返回错误', async () => {
    mockCities['444'] = makeCity('444', Owner.KMT, 10, 0, 0)
    mockResolveLocationId.mockImplementation((id: string) => id)
    const r = await executeOrder({ order: 'battle', from: '444', to: '333' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('无可战之兵')
  })

  it('battle：有 fieldForce 时自动 deploy 并开战', async () => {
    mockStartBattleAnimation.mockReturnValue({ graphics: {} as any, stop: vi.fn() })
    mockResolveLocationId.mockImplementation((id: string) => id)
    const r = await executeOrder({ order: 'battle', from: '111', to: '333' } as any)
    expect(r.ok).toBe(true)
    // fieldForce=10 > 0, deployAmount 未指定 → autoDeploy=0, 不会额外 apply deploy
    // 但会 apply battleStart
    const battleStartCalls = mockApplyEvent.mock.calls.filter(
      (c: any) => c[0].type === 'battleStart',
    )
    expect(battleStartCalls.length).toBe(1)
  })

  it('stopBattle：战斗不存在返回错误', async () => {
    const r = await executeOrder({ order: 'stopBattle', id: 'battle_1' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('不存在')
  })
})

describe('executeOrder 纯视觉指令', () => {
  it('arrowFly：城市不存在返回错误', async () => {
    mockResolveLocationId.mockReturnValue(null)
    const r = await executeOrder({ order: 'arrowFly', from: '111', to: '222' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('出发城市不存在')
  })

  it('radarPulse：城市不存在返回错误', async () => {
    mockResolveLocationId.mockReturnValue(null)
    const r = await executeOrder({ order: 'radarPulse', from: '111' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('出发城市不存在')
  })

  it('orbBurst：合法路径调用动画', async () => {
    mockArrowFly.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'orbBurst', from: '111', to: '222', text: '宣战！' } as any)
    expect(r.ok).toBe(true)
    // orbBurst 内部使用 playArcAnimation（mock 为 mockArrowFly），mode='orb'
    expect(mockArrowFly).toHaveBeenCalledTimes(1)
    const arcArgs = mockArrowFly.mock.calls[0][0]
    expect(arcArgs).toMatchObject({ fromId: '111', toId: '222', text: '宣战！', mode: 'orb', explosion: true })
  })
})

describe('executeOrder 内政指令', () => {
  it('recruit：合法路径', async () => {
    mockDevelopAnimation.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'recruit', gb: '111', amount: 5 } as any)
    expect(r.ok).toBe(true)
    expect(mockApplyEvent).toHaveBeenCalledWith({ type: 'produce', targetGb: '111', amount: 5 })
  })

  it('develop：field 非法返回错误', async () => {
    const r = await executeOrder({ order: 'develop', gb: '111', amount: 5, field: 'bad' } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('field 必须是')
  })

  it('rally：amount 为 0 返��错误（必须非零）', async () => {
    const r = await executeOrder({ order: 'rally', gb: '111', amount: 0 } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('必须是非零')
  })
})

describe('popToast 提示', () => {
  it('成功指令也弹出 toast', async () => {
    await executeOrder({ order: 'setCurrentDate', date: '1931-01-01' } as any)
    expect(mockPush).toHaveBeenCalled()
  })
})

describe('executeOrder 遗漏指令补充', () => {
  it('stopBattles：无战斗时也成功（幂等）', async () => {
    const r = await executeOrder({ order: 'stopBattles' } as any)
    expect(r.ok).toBe(true)
  })

  it('stopBattles：有战斗时清空 battleRegistry 并 applyEvent battleEnd', async () => {
    // 先执行 battle 指令注册一个战斗到 battleRegistry
    mockStartBattleAnimation.mockReturnValue({ graphics: {} as any, stop: vi.fn() })
    await executeOrder({ order: 'battle', from: '111', to: '333' } as any)
    expect(mockApplyEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'battleStart' }))
    mockApplyEvent.mockClear()

    const r = await executeOrder({ order: 'stopBattles' } as any)
    expect(r.ok).toBe(true)
    // stopBattles 会为每个 id 发 battleEnd
    expect(mockApplyEvent).toHaveBeenCalledTimes(1)
    expect(mockApplyEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'battleEnd' }))
  })

  it('listBattles：返回当前战斗列表', async () => {
    mockBattles.push({ id: 'b1', active: true, from: '111', to: '222', attacker: Owner.KMT, defender: Owner.CCP, fromName: 'A', toName: 'B' } as any)
    const r = await executeOrder({ order: 'listBattles' } as any)
    expect(r.ok).toBe(true)
    expect((r as any).battles?.length).toBe(1)
  })

  it('fogCover：云雾蒙太奇，播动画', async () => {
    mockPlayCloudTransition.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'fogCover' } as any)
    expect(r.ok).toBe(true)
    expect(mockPlayCloudTransition).toHaveBeenCalledTimes(1)
  })

  it('fortify：城市不存在返回错误', async () => {
    mockResolveLocationId.mockReturnValue(null)
    const r = await executeOrder({ order: 'fortify', gb: '999', amount: 5 } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('目标城市不存在')
  })

  it('fortify：amount <= 0 返回错误', async () => {
    const r = await executeOrder({ order: 'fortify', gb: '111', amount: 0 } as any)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('amount 必须是正数')
  })

  it('fortify：合法路径 applyEvent cityStatChange(fort)', async () => {
    mockDevelopAnimation.mockResolvedValue({ ok: true })
    const r = await executeOrder({ order: 'fortify', gb: '111', amount: 3 } as any)
    expect(r.ok).toBe(true)
    expect(mockApplyEvent).toHaveBeenCalledWith({ type: 'cityStatChange', targetGb: '111', field: 'fort', delta: 3 })
  })
})

describe('ORDER_TYPES 导出', () => {
  it('包含所有已知指令类型', () => {
    expect(ORDER_TYPES).toContain('arrowFly')
    expect(ORDER_TYPES).toContain('battle')
    expect(ORDER_TYPES).toContain('capture')
    expect(ORDER_TYPES).toContain('moveTroops')
    expect(ORDER_TYPES).toContain('deploy')
    expect(ORDER_TYPES).toContain('reinforce')
    expect(ORDER_TYPES).toContain('recruit')
    expect(ORDER_TYPES).toContain('develop')
    expect(ORDER_TYPES).toContain('fortify')
    expect(ORDER_TYPES).toContain('rally')
    expect(ORDER_TYPES).toContain('stopBattle')
    expect(ORDER_TYPES).toContain('stopBattles')
    expect(ORDER_TYPES).toContain('listBattles')
    expect(ORDER_TYPES).toContain('fogCover')
    expect(ORDER_TYPES).toContain('setFactionAlive')
    expect(ORDER_TYPES).toContain('setCurrentDate')
    expect(ORDER_TYPES).toContain('setCurrentFaction')
  })
})
