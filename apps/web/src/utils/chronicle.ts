/**
 * 战纪（成长轨迹）纯函数层。
 *
 * 从既有 eventLog / 世界态推导玩家成长数据，无副作用、可单测。
 * 与 eventDescribe.ts 同风格：消费 GameEvent，不碰 store，不写世界态。
 *
 * 约定：
 * - buildExpansionTimeline 折叠 eventLog，capture 归属到「其所在回合的起始日期」
 *   （即上一次 dateAdvance 推进到的日期；无任何推进则用开局日期）。
 * - provinceOf 解析 GB 编码的省级行政区划码：编码 = '156' + 6 位行政区划代码
 *   （156 为中国 ISO 3166-1 数字代码），省码为第 4-5 位，如 '156420700' → '42'。
 */

import type { GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { chinaCities } from '@/data/chinaCities'

/** 游戏开局日期（与 store.initWorld 的 currentDate 一致，单一出处） */
export const GAME_START_DATE = '1931-04-01'

/** 扩张时间线条目：一次占领 = 一个节点 */
export interface ExpansionEntry {
  /** 该次占领所属回合的起始日期 */
  date: string
  gb: string
  name: string
}

/**
 * 折叠 eventLog，得玩家（faction）的扩张时间线。
 * 只统计 actor === faction 的 capture；不记录从谁手中夺取（capture 事件无前属主字段）。
 */
export function buildExpansionTimeline(
  eventLog: GameEvent[],
  faction: Owner,
  cities: Record<string, { name: string }>,
  initialDate: string = GAME_START_DATE,
): ExpansionEntry[] {
  const out: ExpansionEntry[] = []
  let cur = initialDate
  for (const e of eventLog) {
    if (e.type === 'dateAdvance') {
      cur = e.date
      continue
    }
    if (e.type === 'capture' && e.actor === faction) {
      out.push({ date: cur, gb: e.targetGb, name: cities[e.targetGb]?.name ?? e.targetGb })
    }
  }
  return out
}

/** GB 编码 → 省级行政区划码。非 '156' 前缀或长度不足返回 null。 */
export function provinceOf(gb: string): string | null {
  if (gb.length >= 5 && gb.startsWith('156')) return gb.slice(3, 5)
  return null
}

/** 省级行政区划码 → 省名（1931 语境下北平沿旧称，其余用当代省名） */
const PROVINCE_NAMES: Record<string, string> = {
  '11': '北平',
  '12': '天津',
  '13': '河北',
  '14': '山西',
  '15': '内蒙古',
  '21': '辽宁',
  '22': '吉林',
  '23': '黑龙江',
  '31': '上海',
  '32': '江苏',
  '33': '浙江',
  '34': '安徽',
  '35': '福建',
  '36': '江西',
  '37': '山东',
  '41': '河南',
  '42': '湖北',
  '43': '湖南',
  '44': '广东',
  '45': '广西',
  '46': '海南',
  '50': '重庆',
  '51': '四川',
  '52': '贵州',
  '53': '云南',
  '54': '西藏',
  '61': '陕西',
  '62': '甘肃',
  '63': '青海',
  '64': '宁夏',
  '65': '新疆',
}

/** 省份静态信息（从 chinaCities 构建一次） */
export interface ProvinceInfo {
  name: string
  total: number
}

let _provinceTable: Record<string, ProvinceInfo> | null = null

/** 世界省份表：省码 → { 省名, 世界总城数 }。模块级缓存，纯读。 */
export function getProvinceTable(): Record<string, ProvinceInfo> {
  if (_provinceTable) return _provinceTable
  const table: Record<string, ProvinceInfo> = {}
  for (const c of chinaCities) {
    const code = provinceOf(c.gb)
    if (!code) continue
    const entry = (table[code] ??= { name: PROVINCE_NAMES[code] ?? code, total: 0 })
    entry.total++
  }
  _provinceTable = table
  return table
}

/** 玩家当前各省占有城数：省码 → 我占城数（供里程碑谓词与区域展示用） */
export function countOwnedByProvince(
  ownership: Record<string, Owner>,
  faction: Owner,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [gb, o] of Object.entries(ownership)) {
    if (o !== faction) continue
    const code = provinceOf(gb)
    if (!code) continue
    out[code] = (out[code] ?? 0) + 1
  }
  return out
}
