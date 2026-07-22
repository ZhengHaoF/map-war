/**
 * 历史上下文装配器。
 *
 * 从 store.eventLog（持久化、结构化、进存档的真相源）抽取「近期世界动态」，
 * 压缩为一段中文时间线文本，供 AI 提示词作为独立 system 消息注入。
 *
 * 三种模式：
 * - recent：最近若干事件（默认跨最近 2 个 dateAdvance 周期），玩家 AI 通用记忆。
 * - sinceDateAdvance：最后一个 dateAdvance 之后的全部事件 = 本轮，世界 AI 结算用。
 * - byActor：某政权相关的动作，政权 AI 决策用。
 *
 * 与 buildWorldContext（现状切片）刻意区分：本文件输出的是「时间线增量」。
 */

import { useGameStore } from '@/stores/game'
import type { GameEvent } from '@/stores/game'
import type { Owner } from '@/data/owners'
import { getCityDisplayName } from '@/data/cityHistoricalNames'

export type HistoryMode = 'recent' | 'sinceDateAdvance' | 'byActor'

export interface BuildHistoryOpts {
  mode?: HistoryMode
  /** mode==='byActor' 时必填：要筛选的政权。 */
  actor?: Owner
  /** 最多取多少条事件（软上限，最终还受 maxChars 限制）。默认 30。 */
  maxEvents?: number
  /** recent 模式下最多向前包含几个 dateAdvance 周期作上下文。默认 2。 */
  maxTurns?: number
  /** 文本最大字符数兜底（≈800 token）。超出从最旧端删行。默认 1200。 */
  maxChars?: number
}

interface ResolvedHistoryOpts {
  mode: HistoryMode
  maxEvents: number
  maxTurns: number
  maxChars: number
  actor?: Owner
}

const DEFAULT_MAX_EVENTS = 30
const DEFAULT_MAX_TURNS = 2
const DEFAULT_MAX_CHARS = 1200

function cityName(store: ReturnType<typeof useGameStore>, gb?: string): string {
  if (!gb) return '?'
  return getCityDisplayName(gb) || (store.cities[gb]?.name ?? gb)
}

/** 单条事件 → 一行中文时间线；无法概述的事件返回 null（被跳过）。 */
function eventLine(store: ReturnType<typeof useGameStore>, e: GameEvent): string | null {
  switch (e.type) {
    case 'dateAdvance':
      return `【日期推进至 ${e.date}】`
    case 'capture':
      return `占领 ${cityName(store, e.targetGb)}（驻军 ${e.resultTroops ?? '?'}k）`
    case 'attack':
      return `${cityName(store, e.fromGb)} 进攻 ${cityName(store, e.targetGb)}（我损 ${e.attackerLoss}k / 敌损 ${e.defenderLoss}k）`
    case 'produce':
      return `${cityName(store, e.targetGb)} 增兵 ${e.amount}k`
    case 'moraleChange':
      return `${cityName(store, e.targetGb)} 士气 ${e.delta >= 0 ? '+' : ''}${e.delta}`
    case 'setFactionAlive':
      return e.alive ? null : `${e.faction} 灭亡`
    case 'narrative': {
      const p = (e.playerInput || '').slice(0, 40)
      const a = (e.aiMessage || '').slice(0, 60)
      return `玩家：「${p}」→ AI：「${a}」`
    }
    default:
      return null
  }
}

/** 从末尾向前数第 n 个 dateAdvance 的下标；不足 n 个返回 -1。 */
function lastDateAdvanceIndex(log: GameEvent[], n: number): number {
  let count = 0
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'dateAdvance') {
      count++
      if (count === n) return i
    }
  }
  return -1
}

/** 按模式挑选事件窗口。 */
function selectWindow(
  store: ReturnType<typeof useGameStore>,
  log: GameEvent[],
  opts: ResolvedHistoryOpts,
): GameEvent[] {
  if (opts.mode === 'sinceDateAdvance') {
    const idx = lastDateAdvanceIndex(log, 1)
    return idx >= 0 ? log.slice(idx + 1) : [...log]
  }
  if (opts.mode === 'byActor') {
    const f = opts.actor
    if (f === undefined) return []
    return log.filter((e) => {
      if (e.type === 'capture') return e.actor === f
      if (e.type === 'attack') return store.cities[e.fromGb]?.owner === f
      if (e.type === 'produce' || e.type === 'moraleChange') return store.cities[e.targetGb]?.owner === f
      if (e.type === 'narrative') return store.currentFaction === f
      return false
    })
  }
  // recent：向前含最近 maxTurns 个 dateAdvance 作上下文，再按 maxEvents 截尾
  const idx = lastDateAdvanceIndex(log, opts.maxTurns)
  let win = idx >= 0 ? log.slice(idx) : [...log]
  if (win.length > opts.maxEvents) win = win.slice(win.length - opts.maxEvents)
  return win
}

export function buildEventHistory(opts: BuildHistoryOpts = {}): string {
  const store = useGameStore()
  const resolved: ResolvedHistoryOpts = {
    mode: opts.mode ?? 'recent',
    maxEvents: opts.maxEvents ?? DEFAULT_MAX_EVENTS,
    maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
    maxChars: opts.maxChars ?? DEFAULT_MAX_CHARS,
    actor: opts.actor,
  }

  const window = selectWindow(store, store.eventLog, resolved)
  const lines = window.map((e) => eventLine(store, e)).filter((l): l is string => l !== null)
  if (!lines.length) return ''

  let text = lines.join('\n')
  // 长度兜底：超长从最旧端（前面）逐行删，保留最新事件
  while (text.length > resolved.maxChars) {
    const nl = text.indexOf('\n')
    if (nl < 0) break
    text = text.slice(nl + 1)
  }
  return text
}
