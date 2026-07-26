/**
 * 指令 → 中文人话（进队栏 / 队列明细用）。
 *
 * 纯函数、无副作用：只做「类型动词 + 势力 + 城市中文名」的拼接，
 * 不触碰世界态，replay / 读档安全。
 */

import type { GameOrder } from '@/utils/gameOrders'
import { resolveLocation } from '@/utils/locationResolver'
import { getDisplayName } from '@/data/displayNames'
import { OWNER_LABELS, type Owner } from '@/data/owners'

/** 指令类型 → 中文动词 */
const VERB: Record<string, string> = {
  arrowFly: '行军',
  radarPulse: '侦察',
  orbBurst: '宣战',
  battle: '战斗',
  stopBattle: '停战',
  stopBattles: '停战',
  listBattles: '列阵',
  fogCover: '时移',
  capture: '占领',
  setFactionAlive: '势力存亡',
  setCurrentDate: '推进日期',
  setCurrentFaction: '择主',
  moveTroops: '调兵',
  deploy: '增援',
  reinforce: '补兵',
  recruit: '募兵',
  develop: '兴业',
  fortify: '筑防',
  rally: '整军',
}

/** gb / iso_a3 编码 → 游戏内中文名（1931 显示名优先，否则 GeoJSON 名，否则原 id） */
function cityName(id?: string): string {
  if (!id) return ''
  const disp = getDisplayName(id)
  if (disp) return disp
  const f = resolveLocation(id)
  const props = f?.properties as { name?: string; NAME?: string } | undefined
  const nm = props?.name || props?.NAME
  return nm || id
}

/** Owner 枚举 → 势力中文名 */
function ownerName(owner?: Owner): string {
  if (!owner) return ''
  return OWNER_LABELS[owner] ?? owner
}

/**
 * 把一条 GameOrder 翻译成人话，如：
 *   battle · 川军 · 重庆 → 成都
 *   占领 · 国民政府 · 北平
 *   推进日期
 */
export function describeOrder(o: GameOrder): string {
  const verb = VERB[o.order] ?? o.order
  const from = cityName(o.from)
  const to = cityName(o.to) || cityName(o.gb)
  const actor = ownerName(o.faction)

  const parts: string[] = [verb]
  if (actor) parts.push(`· ${actor}`)
  if (from && to) parts.push(`${from} → ${to}`)
  else if (from) parts.push(`· ${from}`)
  else if (to) parts.push(`· ${to}`)
  return parts.join(' ')
}
