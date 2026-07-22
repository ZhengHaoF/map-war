/**
 * AI 上下文构建 —— 统一三个 build 函数（faction / minor / settle）。
 *
 * 取代 useAgentKernel 内 3 个 build 函数（buildFactionContext / buildMinorContext /
 * buildRoundEventSummary）的重复代码，#5.3 改动。
 *
 * 关键增强（相对原版）：
 * 1. buildFactionContext：注入【邻接城市 + byActor 历史】（原版只有本势力城市）
 * 2. buildMinorContext：注入【sinceDateAdvance 历史】（原版只给清单）
 * 3. buildSettleContext：直接复用 buildEventHistory（不再手写简化版时间线）
 */
import { useGameStore } from '@/stores/game'
import { chinaCitiesAdjacent } from '@/data/chinaCitiesAdjacent'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { buildEventHistory } from './aiHistory'
import type { CityDataWithAdjacent } from '@/data/chinaCitiesAdjacent'

// ─── 邻接表（模块级只建一次）───
const adjacentMap = new Map<string, string[]>()
for (const c of chinaCitiesAdjacent as CityDataWithAdjacent[]) {
  adjacentMap.set(c.gb, c.adjacent ?? [])
}

/** terrain 英文 → 中文 */
const TERRAIN_LABEL: Record<string, string> = {
  MOUNTAIN: '山地',
  HILL: '丘陵',
  PLAIN: '平原',
  FOREST: '林地',
}

/**
 * 紧凑城市行格式，给 AI：
 *   城名 驻军Xk 士气X 地形 L城级 工事X
 * 可选势力前缀：`势力控 ` 插在城名后（邻接城市用）
 */
function formatCityCompact(gb: string, troops: number, morale: number, terrain?: string, cityLevel?: number, fort?: number, ownerLabel?: string): string {
  const store = useGameStore()
  const name = store.cities[gb]?.name ?? gb
  const parts: string[] = [name]
  if (ownerLabel) parts.push(`${ownerLabel}控`)
  parts.push(`驻军${troops}k`, `士气${morale}`)
  if (terrain) parts.push(TERRAIN_LABEL[terrain] ?? terrain)
  if (cityLevel != null) parts.push(`L${cityLevel}`)
  if (fort != null) parts.push(`工事${fort}`)
  return parts.join(' ')
}

/**
 * 势力决策上下文（给 faction AI 的 user message）
 *
 * 内容：
 * 1. 当前日期 + 势力中文名 + 总兵力
 * 2. 本势力城市详情（驻军 / 士气）
 * 3. 【新增】一阶邻接城市（按 ownership 归类：他方 / 中立）
 * 4. 【新增】byActor 历史（你最近 30 条动作）
 * 5. 引导"无动作合法"
 */
export function buildFactionContext(faction: Owner): string {
  const store = useGameStore()
  const snap = store.getSnapshot()
  const myCities = Object.entries(snap.cities).filter(([, c]) => c.owner === faction)

  const lines: string[] = []
  lines.push(`当前日期：${snap.currentDate}`)
  lines.push('')
  lines.push(`你的势力：${OWNER_LABELS[faction] ?? faction}`)
  lines.push(`你控制 ${myCities.length} 座城市，总兵力 ${snap.factionTroops[faction] ?? 0}k`)
  lines.push('')
  lines.push('城市详情：')
  for (const [gb] of myCities) {
    const full = store.cities[gb]
    if (!full) continue
    lines.push(`  ${formatCityCompact(gb, full.troops, full.morale, full.terrain, full.cityLevel, full.fort)}`)
  }

  // 一阶邻接城市（按归属分组）
  const adjForeign: string[] = []
  const adjNeutral: string[] = []
  for (const [gb] of myCities) {
    const adjs = adjacentMap.get(gb) ?? []
    for (const adjGb of adjs) {
      const c = store.cities[adjGb]
      if (!c) continue
      if (c.owner === faction) continue
      const desc = formatCityCompact(adjGb, c.troops, c.morale, c.terrain, c.cityLevel, c.fort, OWNER_LABELS[c.owner] ?? c.owner)
      if (c.owner === Owner.NEUTRAL) adjNeutral.push(desc)
      else adjForeign.push(desc)
    }
  }
  // 去重（同一邻接城可能被本方多座城共享）
  const uniqueForeign = [...new Set(adjForeign)]
  const uniqueNeutral = [...new Set(adjNeutral)]

  if (uniqueForeign.length || uniqueNeutral.length) {
    lines.push('')
    lines.push('邻接城市（重要！决定可达性）：')
    if (uniqueForeign.length) {
      lines.push(`  他方（${uniqueForeign.length} 座）：`)
      for (const d of uniqueForeign) lines.push(`    - ${d}`)
    }
    if (uniqueNeutral.length) {
      lines.push(`  中立（${uniqueNeutral.length} 座）：`)
      for (const d of uniqueNeutral) lines.push(`    - ${d}`)
    }
  }

  // byActor 历史
  const history = buildEventHistory({ mode: 'recent', maxEvents: 20 })
  if (history) {
    lines.push('')
    lines.push('近期世界动态：')
    lines.push(history)
  }

  lines.push('')
  lines.push('请决定本回合行动。若无必要，返回空 orders。')
  return lines.join('\n')
}

/**
 * Minor 政权批量上下文（给世界 AI 批量代打）
 *
 * 内容：
 * 1. 当前日期
 * 2. 每个次要势力清单（城数 + 兵力）
 * 3. 【新增】sinceDateAdvance 历史（本轮其他势力发生的事——避免世界AI 完全不知道剧情）
 * 4. 引导保守
 */
export function buildMinorContext(factions: Owner[]): string {
  const store = useGameStore()
  const snap = store.getSnapshot()

  const lines: string[] = []
  lines.push(`当前日期：${snap.currentDate}`)
  lines.push('')
  lines.push(`以下 ${factions.length} 个次要势力需要你替它们决定本回合行动：`)
  lines.push('')
  for (const f of factions) {
    const troops = snap.factionTroops[f] ?? 0
    const factionCities = Object.entries(snap.cities).filter(([, c]) => c.owner === f)
    const cityCount = factionCities.length
    const label = OWNER_LABELS[f] ?? f
    lines.push(`- ${label}：${cityCount} 座城，${troops}k 兵力`)
    for (const [gb] of factionCities) {
      const full = store.cities[gb]
      if (!full) continue
      lines.push(`    ${formatCityCompact(gb, full.troops, full.morale, full.terrain, full.cityLevel, full.fort)} 归属${label}`)
    }
    lines.push('')
  }

  // sinceDateAdvance 历史
  const history = buildEventHistory({ mode: 'recent', maxEvents: 20 })
  if (history) {
    lines.push('')
    lines.push('近期世界动态（本轮已发生的事）：')
    lines.push(history)
  }

  lines.push('')
  lines.push('每个势力的行动用 actor 字段标明。保守为上，无大事可按兵不动。')
  return lines.join('\n')
}

/**
 * 世界全景（给玩家 AI 操作台）。
 * 列出所有存活势力及其全部城市（紧凑格式），让玩家 AI 知道全局局势。
 */
export function buildWorldOverview(): string {
  const store = useGameStore()
  const snap = store.getSnapshot()

  const lines: string[] = []
  lines.push(`当前日期：${snap.currentDate}`)
  lines.push('')

  for (const f of snap.activeFactions.sort()) {
    const factionCities = Object.entries(snap.cities).filter(([, c]) => c.owner === f)
    if (!factionCities.length) continue
    const troops = snap.factionTroops[f] ?? 0
    const label = OWNER_LABELS[f] ?? f
    lines.push(`${label}：${factionCities.length} 座城，${troops}k 兵力`)
    for (const [gb] of factionCities) {
      const full = store.cities[gb]
      if (!full) continue
      lines.push(`    ${formatCityCompact(gb, full.troops, full.morale, full.terrain, full.cityLevel, full.fort)} 归属${label}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * P4 结算上下文（给世界 AI 做总结）
 *
 * 内容：
 * 1. 当前日期
 * 2. 本轮事件（sinceDateAdvance 全量）
 * 3. 引导"输出 narrative + newDate"
 */
export function buildSettleContext(currentDate: string): string {
  const lines: string[] = []
  lines.push(`当前日期：${currentDate}`)
  lines.push('')
  lines.push('本回合各势力的行动已经执行完毕。请基于以下事件生成总结：')
  const history = buildEventHistory({ mode: 'recent', maxEvents: 50 })
  lines.push(history || '（本回合无事件）')
  return lines.join('\n')
}
