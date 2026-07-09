/**
 * 游戏指令层 —— AI 专用入口
 *
 * 将高层游戏意图（派兵、宣战、探察、战斗）封装为动画调用。
 * AI 只需返回 { order, from, to, text }，不需要知道任何 Pixi.js 或容器细节。
 *
 * 使用方式：
 *   import { init, attack, scout, declareWar, battle, stopBattles, stopBattle, listBattles, executeOrder } from '@/utils/gameOrders'
 *   init(worldContainer)
 *   await attack('156500000', '156450200', '猛攻！')
 *   await executeOrder({ order: 'attack', from: '156500000', to: '156450200' })
 */

import type { Container } from 'pixi.js'
import { playArcAnimation, playScoutAnimation, startBattleAnimation } from './troopAnimation'
import type { BattleHandle } from './troopAnimation'
import { resolveLocation } from './locationResolver'
import { useGameStore } from '@/stores/game'
import type { Owner } from '@/data/owners'

// ─── 类型定义 ───

export interface OrderResult {
  ok: boolean
  reason?: string
}

export interface BattleOrderResult extends OrderResult {
  id?: string
}

export interface BattleListResult extends OrderResult {
  battles?: BattleInfo[]
}

export interface BattleEntry {
  from: string
  to: string
  fromName: string
  toName: string
}

export interface BattleRuntime {
  battle: BattleHandle
}

export interface BattleInfo {
  id: string
  from: string
  to: string
  fromName: string
  toName: string
  active: boolean
}

export type OrderType = 'attack' | 'scout' | 'declareWar' | 'battle' | 'stopBattle' | 'stopBattles' | 'listBattles'

export interface GameOrder {
  order: OrderType
  from?: string
  to?: string
  id?: string
  text?: string
}

// ─── 内部状态 ───

let _container: Container | null = null

const locks: Record<string, boolean> = {
  attack: false,
  scout: false,
  war: false,
}

const battleRegistry = new Map<string, BattleEntry>()
const activeBattles = new Map<string, BattleRuntime>()

let battleIdCounter = 0

// ─── 内部 helper ───

function getLocationName(id: string): string {
  const f = resolveLocation(id)
  if (!f?.properties) return id
  return (f.properties.name || f.properties.NAME || f.properties.name_local || id) as string
}

function hasActiveBattle(from: string, to: string): boolean {
  for (const entry of battleRegistry.values()) {
    if (entry.from === from && entry.to === to) return true
  }
  return false
}

// ─── 初始化 ───

export function init(container: Container): void {
  _container = container
}

// ─── 五个游戏指令 ───

export async function attack(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.attack) return { ok: false, reason: '派兵动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  locks.attack = true
  try {
    await playArcAnimation({
      fromId: from,
      toId: to,
      container: _container,
      mode: 'dots',
      text: text || '出兵！',
      color: 0xffcc00,
      dots: 5,
      duration: 2000,
    })
    return { ok: true }
  } finally {
    locks.attack = false
  }
}

export async function scout(from: string, text?: string): Promise<OrderResult> {
  if (locks.scout) return { ok: false, reason: '探察动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  locks.scout = true
  try {
    await playScoutAnimation({
      fromId: from,
      container: _container,
      color: 0x22c55e,
      rings: 3,
      duration: 1500,
      text: text || '侦察！',
    })
    return { ok: true }
  } finally {
    locks.scout = false
  }
}

export async function declareWar(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.war) return { ok: false, reason: '宣战动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  locks.war = true
  try {
    await playArcAnimation({
      fromId: from,
      toId: to,
      container: _container,
      mode: 'orb',
      explosion: true,
      shockwaves: 3,
      text: text || '宣战！',
      color: 0xff4444,
      duration: 1200,
      explosionDuration: 800,
    })
    return { ok: true }
  } finally {
    locks.war = false
  }
}

export function battle(from: string, to: string): BattleOrderResult {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  if (hasActiveBattle(from, to)) {
    return { ok: false, reason: `已存在 ${from} → ${to} 的战斗` }
  }

  const b = startBattleAnimation({
    fromId: from,
    toId: to,
    container: _container,
    colorA: 0x3b82f6,
    colorB: 0xef4444,
  })

  if (!b.graphics) {
    return { ok: false, reason: '战斗动画创建失败（无法解析坐标）' }
  }

  const id = `battle_${++battleIdCounter}`

  battleRegistry.set(id, {
    from,
    to,
    fromName: getLocationName(from),
    toName: getLocationName(to),
  })

  activeBattles.set(id, { battle: b })

  // 桥接：同步元数据进响应式 store，战斗面板自动刷新
  useGameStore().battles.push({
    id,
    from,
    to,
    fromName: getLocationName(from),
    toName: getLocationName(to),
    active: true,
  })

  return { ok: true, id }
}

export function stopBattle(id: string): OrderResult {
  const entry = activeBattles.get(id)
  if (!entry) return { ok: false, reason: `战斗 ${id} 不存在` }

  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
  useGameStore().battles = useGameStore().battles.filter(b => b.id !== id)
  return { ok: true }
}

export function stopBattles(): OrderResult {
  for (const entry of activeBattles.values()) {
    entry.battle.stop()
  }
  activeBattles.clear()
  battleRegistry.clear()
  useGameStore().battles = []
  return { ok: true }
}

export function listBattles(): BattleInfo[] {
  return useGameStore().battles.slice()
}

// ─── AI 世界状态写回接口（最小参数）───
// 这些 setter 是 AI 指令「落地」时回写 store 的入口：
// 只接收最少必要参数，不直接碰 PixiJS，也不处理动画。

/**
 * 设置/变更某城市的控制政权（占领、易主）。
 * @param gb    城市 gb 编码
 * @param owner 新的控制政权
 */
export function setCityOwner(gb: string, owner: Owner): void {
  useGameStore().ownership[gb] = owner
}

/**
 * 设置某势力的存活状态。
 * @param f     势力
 * @param alive true=加入存活列表，false=从存活列表移除（灭亡）
 */
export function setFactionAlive(f: Owner, alive: boolean): void {
  const s = useGameStore()
  const has = s.activeFactions.includes(f)
  if (alive && !has) s.activeFactions.push(f)
  if (!alive && has) s.activeFactions = s.activeFactions.filter(x => x !== f)
}

/**
 * 推进全局日期时钟。
 * @param date ISO 格式日期字符串，如 '1931-10-01'
 */
export function setCurrentDate(date: string): void {
  useGameStore().currentDate = date
}

/**
 * 设置玩家所选势力（委托给 store 内置的 selectFaction，避免逻辑分叉）。
 * @param f 玩家势力
 */
export function setCurrentFaction(f: Owner): void {
  useGameStore().selectFaction(f)
}

// ─── AI JSON 协议解析器 ───

/**
 * AI JSON 指令解析器 —— 将 AI 返回的 JSON 分发到对应方法。
 */
export async function executeOrder(json: GameOrder): Promise<OrderResult | BattleOrderResult | BattleListResult> {
  if (!json || !json.order) {
    return { ok: false, reason: '缺少 order 字段' }
  }

  switch (json.order) {
    case 'attack':
      return attack(json.from!, json.to!, json.text)

    case 'scout':
      return scout(json.from!, json.text)

    case 'declareWar':
      return declareWar(json.from!, json.to!, json.text)

    case 'battle':
      return battle(json.from!, json.to!)

    case 'stopBattle':
      return stopBattle(json.id!)

    case 'stopBattles':
      return stopBattles()

    case 'listBattles':
      return { ok: true, battles: listBattles() }

    default:
      return { ok: false, reason: `未知指令: ${json.order}` }
  }
}
