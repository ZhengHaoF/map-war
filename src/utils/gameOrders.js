/**
 * 游戏指令层 —— AI 专用入口
 *
 * 将高层游戏意图（派兵、宣战、探察、战斗）封装为动画调用。
 * AI 只需返回 { order, from, to, text }，不需要知道任何 Pixi.js 或容器细节。
 *
 * 使用方式：
 *   import { init, attack, scout, declareWar, battle, stopBattles, executeOrder } from '@/utils/gameOrders'
 *   init(worldContainer)
 *   await attack('156500000', '156450200', '猛攻！')
 *   await executeOrder({ order: 'attack', from: '156500000', to: '156450200' })
 */

import { playArcAnimation, playScoutAnimation, startBattleAnimation } from './troopAnimation'

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
 * 持续战斗动画列表。
 * battle() 每个目标创建一个 startBattleAnimation 实例并推入此数组，
 * stopBattles() 遍历调用 .stop() 后清空。
 */
const activeBattles = []

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
 * 持续战斗动画 —— 双向箭头在起点和多个终点之间循环交火。
 * 每个目标独立创建一个动画实例，需手动 stopBattles() 停止。
 * @param {string} from - 起点地点 id（己方城市）
 * @param {string[]} tos - 终点地点 id 数组（敌方城市，可多个）
 * @param {string} [text] - 目前未使用，保留供后续扩展
 * @returns {{ ok: boolean, reason?: string, count: number }}
 */
export function battle(from, tos, text) {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  if (!Array.isArray(tos) || tos.length === 0) {
    return { ok: false, reason: 'battle 的 to 参数需要是非空数组' }
  }

  for (const to of tos) {
    const b = startBattleAnimation({
      fromId: from,
      toId: to,
      container: _container,
      colorA: 0x3b82f6,
      colorB: 0xef4444,
    })
    if (b.graphics) activeBattles.push(b)
  }

  return { ok: true, count: tos.length }
}

/**
 * 停止所有持续战斗动画并清空列表。
 * @returns {{ ok: boolean }}
 */
export function stopBattles() {
  for (const b of activeBattles) {
    b.stop()
  }
  activeBattles.length = 0
  return { ok: true }
}

// ─── AI JSON 协议解析器 ───

/**
 * AI JSON 指令解析器 —— 将 AI 返回的 JSON 分发到对应方法。
 *
 * 支持的指令格式：
 *   { "order": "attack",      "from": "id", "to": "id",                    "text?": "xxx" }
 *   { "order": "scout",       "from": "id",                               "text?": "xxx" }
 *   { "order": "declareWar",  "from": "id", "to": "id",                    "text?": "xxx" }
 *   { "order": "battle",      "from": "id", "to": ["id1", "id2", ...] }
 *   { "order": "stopBattles" }
 *
 * @param {Object} json - AI 返回的指令对象
 * @param {string} json.order - 指令类型
 * @param {string} json.from - 起点地点 id
 * @param {string|string[]} [json.to] - 终点 id（attack/declareWar 为字符串，battle 为数组）
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
      return battle(json.from, json.to, json.text)

    case 'stopBattles':
      return stopBattles()

    default:
      return { ok: false, reason: `未知指令: ${json.order}` }
  }
}
