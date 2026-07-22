/**
 * aiHistory.eventLine 单测
 * #2 改动：narrative 事件按 kind 分支（player = 玩家对话；settlement = 系统结算）
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { useGameStore } from '../stores/game'
import { buildEventHistory } from '../utils/aiHistory'
import { registerLocations, clearLocations } from '../utils/locationResolver'
import type { GameEvent } from '../stores/game'

// 至少注册一个 city（buildEventHistory 内部会查 cityName 兜底）
const TEST_GB = '156500001'
beforeAll(() => {
  clearLocations()
  const features: GeoJSON.Feature[] = [
    { type: 'Feature', properties: { name: '成都', gb: TEST_GB }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ] as unknown as GeoJSON.Feature[]
  registerLocations(features, 'gb')
})

function makeLog(events: GameEvent[]): void {
  const store = useGameStore()
  store.initWorld()
  for (const e of events) store.applyEvent(e)
}

describe('aiHistory.eventLine / narrative kind', () => {
  it('narrative.kind=settlement 渲染为"📜 …"，不带"玩家："前缀', () => {
    const store = useGameStore()
    makeLog([
      { type: 'narrative', playerInput: '', aiMessage: '世局动荡，晋系按兵不动', kind: 'settlement' },
    ])
    const text = buildEventHistory({ mode: 'recent', maxEvents: 10 })
    expect(text).toContain('📜')
    expect(text).toContain('世局动荡')
    expect(text).not.toContain('玩家：')
  })

  it('narrative.kind=player 渲染为"玩家：「…」→ AI：「…"（旧版默认）', () => {
    const store = useGameStore()
    makeLog([
      { type: 'narrative', playerInput: '派兵进攻杭州', aiMessage: '已命前锋开拔', kind: 'player' },
    ])
    const text = buildEventHistory({ mode: 'recent', maxEvents: 10 })
    expect(text).toContain('玩家：')
    expect(text).toContain('派兵进攻杭州')
    expect(text).toContain('已命前锋开拔')
    expect(text).not.toContain('📜')
  })

  it('narrative 缺省 kind 时走 player 分支（老存档兼容）', () => {
    const store = useGameStore()
    makeLog([
      // kind 缺省（老存档/手动构造事件可能没有）
      { type: 'narrative', playerInput: '进军南京', aiMessage: '前锋已启程' } as GameEvent,
    ])
    const text = buildEventHistory({ mode: 'recent', maxEvents: 10 })
    expect(text).toContain('玩家：')
    expect(text).not.toContain('📜')
  })

  it('settlement 与 player 混合时按各自渲染', () => {
    const store = useGameStore()
    makeLog([
      { type: 'narrative', playerInput: '派兵进攻', aiMessage: '已出发', kind: 'player' },
      { type: 'narrative', playerInput: '', aiMessage: '回合落幕', kind: 'settlement' },
    ])
    const text = buildEventHistory({ mode: 'recent', maxEvents: 10 })
    // 玩家对话与系统结算应同时出现
    expect(text).toContain('玩家：')
    expect(text).toContain('📜')
    expect(text).toContain('回合落幕')
  })

  it('settlement 空 aiMessage 时返回 null（被跳过）', () => {
    const store = useGameStore()
    makeLog([
      { type: 'narrative', playerInput: '', aiMessage: '', kind: 'settlement' },
    ])
    const text = buildEventHistory({ mode: 'recent', maxEvents: 10 })
    expect(text).toBe('')
  })
})
