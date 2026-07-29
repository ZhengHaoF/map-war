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
