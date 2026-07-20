/**
 * 政权分类器（算法 B：接壤 + 近期互动）。
 *
 * 纯函数 —— P2 起点调用，零 AI 成本，确定 + replay 安全。
 * 输入：store（useGameStore），输出：{ related, unrelated }。
 */

import { chinaCitiesAdjacent } from '@/data/chinaCitiesAdjacent'
import { Owner } from '@/data/owners'
import type { GameEvent } from '@/stores/game'

/** 预建邻接查表：gb → 相邻城 gb 列表（模块级，只建一次）。 */
const adjacentMap = new Map<string, string[]>()
for (const c of chinaCitiesAdjacent) {
  adjacentMap.set(c.gb, c.adjacent ?? [])
}

/** 从事件中提取涉及的势力（actor / target 的城主） */
function extractFactionsFromEvent(
  e: GameEvent,
  getOwner: (gb: string) => Owner | undefined,
): Owner[] {
  const factions: Owner[] = []
  if ('actor' in e && typeof e.actor === 'string') {
    factions.push(e.actor as Owner)
  }
  // capture / attack / moveTroops / battleStart / moraleChange / produce
  if ('targetGb' in e && typeof e.targetGb === 'string') {
    const o = getOwner(e.targetGb as string)
    if (o && o !== Owner.NEUTRAL) factions.push(o)
  }
  if ('fromGb' in e && typeof e.fromGb === 'string') {
    const o = getOwner(e.fromGb as string)
    if (o && o !== Owner.NEUTRAL) factions.push(o)
  }
  return factions
}

export interface FactionClassification {
  /** 与玩家直接相关（接壤 或 近期互动）—— 应唤起专属 AI 实例 */
  related: Owner[]
  /** 与玩家无关 —— 由世界 AI 一次性批量代打 */
  unrelated: Owner[]
}

/**
 * 按算法 B 分类存活非玩家势力。
 *
 * ① 接壤：遍历玩家所有城市，读取 adjacent[] 中每个邻城城主。
 *    若邻城 ≠ 玩家 / NEUTRAL → 该势力纳入 related。
 *
 * ② 近期互动：从 eventLog 自上次 dateAdvance 截片（无 dateAdvance 则取全部）。
 *    提取每条事件中涉及的 actor / target / fromGb 城主。
 *    若 ≠ 玩家 → 纳入 related。
 *
 * ③ related = ① ∪ ②（仅保留存活、≠ 玩家的势力）。
 * ④ unrelated = 存活 ∩ (¬related) \ {玩家}。
 */
export function classifyFactions(opts: {
  /** 玩家势力 identity */
  playerFaction: Owner | null
  /** 当前存活势力列表 */
  activeFactions: Owner[]
  /** 归属表：gb → owner */
  ownership: Record<string, Owner>
  /** 玩家拥有的城市 gb 列表 */
  playerCities: string[]
  /** 事件日志（用于提取近期互动） */
  eventLog: GameEvent[]
}): FactionClassification {
  const { playerFaction, activeFactions, ownership, playerCities, eventLog } = opts

  // 如未选势力，全部视为 unrelated
  if (!playerFaction) {
    return { related: [], unrelated: [...activeFactions] }
  }

  const getOwner = (gb: string): Owner | undefined => ownership[gb]
  const related = new Set<Owner>()

  // ① 接壤
  for (const playerGb of playerCities) {
    const adjacents = adjacentMap.get(playerGb)
    if (!adjacents) continue
    for (const adjGb of adjacents) {
      const o = getOwner(adjGb)
      if (o && o !== playerFaction && o !== Owner.NEUTRAL && activeFactions.includes(o)) {
        related.add(o)
      }
    }
  }

  // ② 近期互动（自上次 dateAdvance 截片；若从未推进日期，取全部 eventLog）
  let lastAdvIdx = -1
  for (let i = eventLog.length - 1; i >= 0; i--) {
    if (eventLog[i].type === 'dateAdvance') { lastAdvIdx = i; break }
  }
  const recent = lastAdvIdx >= 0 ? eventLog.slice(lastAdvIdx + 1) : eventLog

  for (const e of recent) {
    for (const f of extractFactionsFromEvent(e, getOwner)) {
      if (f !== playerFaction && f !== Owner.NEUTRAL && activeFactions.includes(f)) {
        related.add(f)
      }
    }
  }

  // ③ → ④
  const relatedList = [...related]
  const unrelatedList = activeFactions.filter((f) => f !== playerFaction && !relatedList.includes(f))

  return { related: relatedList, unrelated: unrelatedList }
}
