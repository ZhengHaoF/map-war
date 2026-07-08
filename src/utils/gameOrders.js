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

import { playArcAnimation, playScoutAnimation, startBattleAnimation } from './troopAnimation'
import { resolveLocation } from './locationResolver'

// ─── 内部状态 ───

/** 动画绘制的父容器（LeafletMap 的 worldContainer），init() 时注入 */
let _container = null

/**
 * 单次动画互斥锁，防止同一类型的动画叠加播放。
 * attack/scout/war 各自独立，可同时进行（如派兵 + 探察）。
 */
const locks = {
  attack: false,
  scout: false,
  war: false,
}

/**
 * 战斗注册表（纯数据，可序列化）。
 * Map<id, { from, to, fromName, toName }>
 */
const battleRegistry = new Map()

/**
 * 战斗运行时列表（Pixi.js 控制对象，不可序列化）。
 * Map<id, { battle: { stop, graphics } }>
 */
const activeBattles = new Map()

let battleIdCounter = 0

// ─── 内部 helper ───

/**
 * 按地点 id 解析出可读名称（从 locationResolver 注册表中取 GeoJSON properties.name 等字段）
 */
function getLocationName(id) {
  const f = resolveLocation(id)
  if (!f?.properties) return id
  return f.properties.name || f.properties.NAME || f.properties.name_local || id
}

/**
 * 检查是否已存在相同 from → to 的战斗
 */
function hasActiveBattle(from, to) {
  for (const entry of battleRegistry.values()) {
    if (entry.from === from && entry.to === to) return true
  }
  return false
}

// ─── 初始化 ───

/**
 * 注入动画容器，必须在 LeafletMap 挂载完成后调用。
 * @param {import('pixi.js').Container} container - 通常是 worldContainer
 */
export function init(container) {
  _container = container
}

// ─── 五个游戏指令 ───

/**
 * 派兵动画 —— 多箭头沿弧线从起点飞往终点（dots 模式）。
 * @param {string} from - 起点地点 id（城市 gb / 国家 iso_a3）
 * @param {string} to   - 终点地点 id
 * @param {string} [text] - 弹出文字，不传则默认"出兵！"
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function attack(from, to, text) {
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

/**
 * 探察动画 —— 从起点向外扩散绿色圆环。
 * @param {string} from - 起点地点 id
 * @param {string} [text] - 弹出文字，不传则默认"侦察！"
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function scout(from, text) {
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

/**
 * 宣战动画 —— 光球沿弧线飞往终点并爆炸（orb + explosion 模式）。
 * @param {string} from - 发起方地点 id
 * @param {string} to   - 目标地点 id
 * @param {string} [text] - 弹出文字，不传则默认"宣战！"
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function declareWar(from, to, text) {
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

/**
 * 持续战斗动画 —— 双向箭头在两个地点之间循环交火（一对一）。
 * 同一对 from → to 不可重复发起。每个战斗分配唯一 id，可单独停止。
 * @param {string} from - 起点地点 id（己方城市）
 * @param {string} to   - 终点地点 id（敌方城市）
 * @returns {{ ok: boolean, reason?: string, id?: string }}
 */
export function battle(from, to) {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  // 重复检查：同一对地点不能重复发起战斗
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

  // 写入注册表（纯数据，可序列化）
  battleRegistry.set(id, {
    from,
    to,
    fromName: getLocationName(from),
    toName: getLocationName(to),
  })

  // 写入运行时（Pixi 控制对象）
  activeBattles.set(id, { battle: b })

  return { ok: true, id }
}

/**
 * 停止指定战斗（按 id 精确停止）。
 * @param {string} id - 战斗 id
 * @returns {{ ok: boolean, reason?: string }}
 */
export function stopBattle(id) {
  const entry = activeBattles.get(id)
  if (!entry) return { ok: false, reason: `战斗 ${id} 不存在` }

  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
  return { ok: true }
}

/**
 * 停止所有持续战斗动画并清空注册表。
 * @returns {{ ok: boolean }}
 */
export function stopBattles() {
  for (const entry of activeBattles.values()) {
    entry.battle.stop()
  }
  activeBattles.clear()
  battleRegistry.clear()
  return { ok: true }
}

/**
 * 返回当前所有战斗的数据列表（纯数据，不包含 Pixi 运行时对象）。
 * 用于调试或 UI 展示当前战斗状态。
 * @returns {{ id: string, from: string, to: string, fromName: string, toName: string, active: boolean }[]}
 */
export function listBattles() {
  const result = []
  for (const [id, data] of battleRegistry.entries()) {
    result.push({
      id,
      from: data.from,
      to: data.to,
      fromName: data.fromName,
      toName: data.toName,
      active: activeBattles.has(id),
    })
  }
  return result
}

// ─── AI JSON 协议解析器 ───

/**
 * AI JSON 指令解析器 —— 将 AI 返回的 JSON 分发到对应方法。
 *
 * 支持的指令格式：
 *   { "order": "attack",      "from": "id", "to": "id",                    "text?": "xxx" }
 *   { "order": "scout",       "from": "id",                               "text?": "xxx" }
 *   { "order": "declareWar",  "from": "id", "to": "id",                    "text?": "xxx" }
 *   { "order": "battle",      "from": "id", "to": "id" }
 *   { "order": "stopBattle",  "id": "battle_id" }
 *   { "order": "stopBattles" }
 *   { "order": "listBattles" }
 *
 * @param {Object} json - AI 返回的指令对象
 * @param {string} json.order - 指令类型
 * @param {string} json.from - 起点地点 id
 * @param {string} [json.to] - 终点地点 id
 * @param {string} [json.id] - 战斗 id（仅 stopBattle 使用）
 * @param {string} [json.text] - 可选文字
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function executeOrder(json) {
  if (!json || !json.order) {
    return { ok: false, reason: '缺少 order 字段' }
  }

  switch (json.order) {
    case 'attack':
      return attack(json.from, json.to, json.text)

    case 'scout':
      return scout(json.from, json.text)

    case 'declareWar':
      return declareWar(json.from, json.to, json.text)

    case 'battle':
      return battle(json.from, json.to)

    case 'stopBattle':
      return stopBattle(json.id)

    case 'stopBattles':
      return stopBattles()

    case 'listBattles':
      return { ok: true, battles: listBattles() }

    default:
      return { ok: false, reason: `未知指令: ${json.order}` }
  }
}
