/**
 * aiClassify 纯函数单测
 * 覆盖：classifyFactions
 */
import { describe, it, expect } from 'vitest'
import { classifyFactions } from '../utils/aiClassify'
import { Owner } from '@/data/owners'
import type { GameEvent } from '@/stores/game'

describe('classifyFactions', () => {
  it('未选势力时���部 unrelated', () => {
    const r = classifyFactions({
      playerFaction: null,
      activeFactions: [Owner.KMT, Owner.CCP],
      ownership: {},
      eventLog: [],
    })
    expect(r.related).toEqual([])
    expect(r.unrelated).toEqual([Owner.KMT, Owner.CCP])
  })

  it('无事件时全部 unrelated（排除玩家）', () => {
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP, Owner.JPN],
      ownership: {},
      eventLog: [],
    })
    expect(r.related).toEqual([])
    expect(r.unrelated).toEqual([Owner.CCP, Owner.JPN])
  })

  it('近期互动中涉及的势力归为 related', () => {
    const events: GameEvent[] = [
      { type: 'dateAdvance', date: '1931-01-01' },
      { type: 'capture', targetGb: '111', actor: Owner.CCP },
    ]
    const ownership: Record<string, Owner> = { '111': Owner.KMT }
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP, Owner.JPN],
      ownership,
      eventLog: events,
    })
    expect(r.related).toContain(Owner.CCP)
    expect(r.unrelated).not.toContain(Owner.CCP)
    expect(r.unrelated).toContain(Owner.JPN)
  })

  it('dateAdvance 之后的事件才算近期互动', () => {
    const events: GameEvent[] = [
      { type: 'dateAdvance', date: '1931-01-01' },
      { type: 'capture', targetGb: '111', actor: Owner.CCP },
      { type: 'dateAdvance', date: '1931-02-01' },
      { type: 'capture', targetGb: '222', actor: Owner.JPN },
    ]
    const ownership: Record<string, Owner> = { '111': Owner.KMT, '222': Owner.JPN }
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP, Owner.JPN],
      ownership,
      eventLog: events,
    })
    // 只取最后一个 dateAdvance 之后的事件
    expect(r.related).toContain(Owner.JPN)
    expect(r.related).not.toContain(Owner.CCP)
  })

  it('moveTroops 的 fromGb 和 targetGb 都提取', () => {
    // moveTroops 在 eventLog 中存为 targetGb（applyEvent 时转换）
    const events: GameEvent[] = [
      { type: 'moveTroops', fromGb: '111', targetGb: '222' } as any,
    ]
    const ownership: Record<string, Owner> = { '111': Owner.KMT, '222': Owner.CCP }
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP, Owner.JPN],
      ownership,
      eventLog: events,
    })
    expect(r.related).toContain(Owner.CCP)
  })

  it('NEUTRAL 势力不计入 related', () => {
    const events: GameEvent[] = [
      { type: 'capture', targetGb: '111', actor: Owner.CCP },
    ]
    const ownership: Record<string, Owner> = { '111': Owner.NEUTRAL }
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP, Owner.JPN],
      ownership,
      eventLog: events,
    })
    expect(r.related).not.toContain(Owner.NEUTRAL)
  })

  it('已覆灭势力不计入 unrelated（仅保留 active 势力）', () => {
    const r = classifyFactions({
      playerFaction: Owner.KMT,
      activeFactions: [Owner.KMT, Owner.CCP],
      ownership: {},
      eventLog: [],
    })
    expect(r.unrelated).not.toContain(Owner.JPN)
    expect(r.unrelated.length).toBe(1)
  })
})
