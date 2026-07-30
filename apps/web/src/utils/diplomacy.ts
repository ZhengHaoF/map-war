/**
 * 外交关系基建 —— 三态（war/peace/alliance）+ 对称存储 + 停战冷却期。
 *
 * 纯函数、零依赖（仅引 Owner 类型），供 store / AI 契约 / 分类器 / 面板共用。
 * 设计定稿：docs/外交系统落地方案.md（2026-07-29 grill-me 锁定）。
 *
 * 关键约定：
 * - 关系对称：A-B === B-A，用 relationKey 字母序归一化，发起方只记 actor 做叙事。
 * - 停战不独立成态：= peace + truceUntil 字段，冷却期内禁止再次宣战。
 * - 未出现的键默认 peace（不初始化 45 对）。
 */

import type { Owner } from '@/data/owners'

/** 外交关系三态 */
export type RelationStatus = 'war' | 'peace' | 'alliance'

export interface Relation {
  status: RelationStatus
  /** 停战冷却期截止日（ISO）；仅从 war→peace 时设置；此日期前禁止再次宣战 */
  truceUntil?: string
  /** 叙事备注（如"九一八事变，日军悍然宣战"），仅展示用 */
  note?: string
}

/** 对称键：两 Owner 按字母序拼接，保证 A-B === B-A */
export function relationKey(a: Owner, b: Owner): string {
  return [a, b].sort().join('-')
}

/** 读取关系（未出现的键默认 peace） */
export function readRelation(
  relations: Record<string, Relation>,
  a: Owner,
  b: Owner,
): Relation {
  return relations[relationKey(a, b)] ?? { status: 'peace' }
}

/** 判断是否处于战争 */
export function isAtWar(relations: Record<string, Relation>, a: Owner, b: Owner): boolean {
  return readRelation(relations, a, b).status === 'war'
}

/** 判断是否同盟 */
export function isAllied(relations: Record<string, Relation>, a: Owner, b: Owner): boolean {
  return readRelation(relations, a, b).status === 'alliance'
}

/**
 * 判断是否处于停战冷却期（当前日期 < truceUntil）。
 * date 缺省时视为"始终在冷却中"（保守拒绝，避免漏校验）。
 */
export function isInTruce(
  relations: Record<string, Relation>,
  a: Owner,
  b: Owner,
  currentDate?: string,
): boolean {
  const rel = readRelation(relations, a, b)
  if (!rel.truceUntil) return false
  if (!currentDate) return true
  return currentDate < rel.truceUntil
}

// ─── 三段式协商（Phase2）───

/**
 * 外交意图分类（第一段世界AI路由识别）。
 * v1 仅军事外交：结盟/停战/宣战/解除结盟/借道；custom 兜底。
 */
export type DiplomacyIntent =
  | 'alliance' // 结盟
  | 'peace' // 停战/和谈
  | 'war' // 宣战
  | 'breakAlliance' // 解除结盟
  | 'passage' // 请求借道/通行
  | 'custom' // 其他自定义请求

/**
 * 目标阵营回应立场（第二段）。
 * stall 已砍（改"婉言谢绝"= reject 的文言皮肤），故仅三态。
 */
export type DiplomacyStance = 'accept' | 'reject' | 'counter'

/** 意图 → 中文描述（注入 prompt / 展示用） */
export const INTENT_LABELS: Record<DiplomacyIntent, string> = {
  alliance: '结盟',
  peace: '停战议和',
  war: '宣战',
  breakAlliance: '解除结盟',
  passage: '借道通行',
  custom: '交涉',
}

/**
 * 意图 → 收口 accept 时对应的关系态。
 * peace/war/alliance 直接映射；breakAlliance → peace；passage/custom 不改关系（null）。
 */
export function intentToRelationStatus(intent: DiplomacyIntent): RelationStatus | null {
  if (intent === 'alliance') return 'alliance'
  if (intent === 'peace') return 'peace'
  if (intent === 'war') return 'war'
  if (intent === 'breakAlliance') return 'peace'
  return null // passage / custom 不改关系矩阵
}

/** 协商单轮记录（玩家发言 + 对方回应） */
export interface DiplomacyRound {
  round: number // 从 1 开始
  playerMessage: string // 玩家本轮发言（第一轮为原始意图）
  stance: DiplomacyStance
  reply: string // 对方领袖回复文本
  counterOffer?: string // stance='counter' 时的反提议
  conditions?: string[] // 接受/反提议附带的条件
}

/**
 * 协商会话/历史记录 —— 持久化的第二公民（电报孪生，不进 eventLog、不改世界态）。
 *
 * 生命周期：negotiating（进行中，唯一）→ settled（达成/被拒收口）/ abandoned（玩家放弃）。
 * 进行中 session 存 useDiplomacyBus 模块级 ref；存档时连进行中一并写入，
 * 读档时 status==='negotiating' 的捞回 currentSession 续谈。
 */
export interface DiplomacyRecord {
  id: string // 'diplo_' + 时间戳
  playerFaction: Owner
  targetFaction: Owner
  intent: DiplomacyIntent
  rounds: DiplomacyRound[] // 全程对话
  finalStance?: DiplomacyStance // 收口时的最终立场
  settleNarrative?: string // 第三段世界AI收口叙事
  status: 'negotiating' | 'settled' | 'abandoned'
  createdAt: string // 游戏日期（发起时）
}
