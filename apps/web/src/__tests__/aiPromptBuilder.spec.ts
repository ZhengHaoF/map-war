/**
 * aiPromptBuilder 单测
 * 覆盖：buildSystemPrompt / buildPlayerProfile / buildMessages
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildSystemPrompt, buildPlayerProfile, buildMessages } from '../utils/aiPromptBuilder'

// mock useGameStore
const mockCities: Record<string, any> = {
  '111': { owner: 'KMT', troops: 10, morale: 50, terrain: 'plain', cityLevel: 2, fort: 5 },
  '222': { owner: 'CCP', troops: 5, morale: 60, terrain: 'hill', cityLevel: 1, fort: 0 },
}

const mockStore = {
  playerName: 'TestPlayer',
  currentFaction: 'KMT',
  cities: mockCities,
  getSnapshot: () => ({
    currentDate: '1931-05-01',
    activeFactions: ['KMT', 'CCP', 'JPN'],
    cities: mockCities,
    factionTroops: { KMT: 10, CCP: 5, JPN: 0 },
    factionTreasury: { KMT: 100, CCP: 50, JPN: 0 },
    factionGranary: { KMT: 80, CCP: 40, JPN: 0 },
  }),
}

vi.mock('@/stores/game', () => ({
  useGameStore: () => mockStore,
}))

// 每次测试前刷新 mock
beforeEach(() => {
  Object.assign(mockStore, { playerName: 'TestPlayer', currentFaction: 'KMT' })
})

describe('buildSystemPrompt', () => {
  it('world 模式返回 god-mode prompt', () => {
    const p = buildSystemPrompt('world')
    expect(p).toContain('最高权限')
    expect(p).toContain('game master')
  })

  it('user 模式返回玩家代理 prompt', () => {
    const p = buildSystemPrompt('user')
    expect(p).toContain('世界AI')
    expect(p).toContain('裁定')
  })

  it('advisor 模式返回顾问 prompt', () => {
    const p = buildSystemPrompt('advisor')
    expect(p).toContain('战略顾问')
    expect(p).toContain('suggestions')
  })

  it('默认值（不传参数）等价于 world', () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt('world'))
  })
})

describe('buildPlayerProfile', () => {
  it('返回玩家名称和势力', () => {
    const p = buildPlayerProfile()
    expect(p).toContain('TestPlayer')
    expect(p).toContain('国民政府')
    expect(p).toContain('KMT')
  })

  it('未设置玩家名称时显示占位', () => {
    mockStore.playerName = ''
    const p = buildPlayerProfile()
    expect(p).toContain('（未设置）')
  })

  it('未选势力时显示占位', () => {
    mockStore.currentFaction = ''
    const p = buildPlayerProfile()
    expect(p).toContain('（未选）')
  })
})

describe('buildMessages', () => {
  it('最小调用：仅 system + user', () => {
    const msgs = buildMessages({ userText: 'hello' })
    expect(msgs.length).toBe(2)
    expect(msgs[0]).toEqual({ role: 'system', content: expect.any(String) })
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'hello' })
  })

  it('injectContext 注入玩家信息', () => {
    const msgs = buildMessages({ userText: 'hi', injectContext: true })
    const sysMsgs = msgs.filter((m) => m.role === 'system' && m.content.includes('玩家信息'))
    expect(sysMsgs.length).toBe(1)
  })

  it('injectWorldOverview 注入世界全景', () => {
    const msgs = buildMessages({ userText: 'hi', injectWorldOverview: true })
    const sysMsgs = msgs.filter((m) => m.role === 'system' && m.content.includes('世界全景'))
    expect(sysMsgs.length).toBe(1)
  })

  it('history 注入近期动态', () => {
    const msgs = buildMessages({ userText: 'hi', history: '近期动态内容' })
    const sysMsgs = msgs.filter((m) => m.role === 'system' && m.content.includes('近期世界动态'))
    expect(sysMsgs.length).toBe(1)
  })

  it('空 history 不注入', () => {
    const msgs = buildMessages({ userText: 'hi', history: '   ' })
    const sysMsgs = msgs.filter((m) => m.role === 'system' && m.content.includes('近期世界动态'))
    expect(sysMsgs.length).toBe(0)
  })

  it('chatTurns 注入历史对话', () => {
    const msgs = buildMessages({
      userText: '新消息',
      chatTurns: [
        { userText: '上轮用户', assistantText: '上轮AI' },
      ],
    })
    // system + 历史 user/assistant 对 + 当前 user
    expect(msgs).toHaveLength(4)
    expect(msgs[1]).toEqual({ role: 'user', content: '上轮用户' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: '上轮AI' })
    expect(msgs[3]).toEqual({ role: 'user', content: '新消息' })
  })

  it('多轮 chatTurns 按序插入', () => {
    const msgs = buildMessages({
      userText: '第三轮',
      chatTurns: [
        { userText: 'U1', assistantText: 'A1' },
        { userText: 'U2', assistantText: 'A2' },
      ],
    })
    expect(msgs).toHaveLength(6)
    expect(msgs[1]).toEqual({ role: 'user', content: 'U1' })
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'A1' })
    expect(msgs[3]).toEqual({ role: 'user', content: 'U2' })
    expect(msgs[4]).toEqual({ role: 'assistant', content: 'A2' })
    expect(msgs[5]).toEqual({ role: 'user', content: '第三轮' })
  })
})
