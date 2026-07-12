/**
 * 游戏指令层 —— AI 专用入口
 *
 * 将高层游戏意图（派兵、宣战、探察、战斗）封装为动画调用。
 * AI 只需返回 { order, from, to, text }，不需要知道任何 Pixi.js 或容器细节。
 *
 * 使用方式：
 *   import { init, attack, scout, declareWar, battle, capture, stopBattles, stopBattle, listBattles, cloudTransition, executeOrder } from '@/utils/gameOrders'
 *   init(worldContainer, cameraController, app)   // 第三个参数注入 PixiJS app（云雾蒙太奇需要）
 *   await attack('156500000', '156450200', '猛攻！')
 *   await capture('156450200', Owner.KMT, 20)     // 先播占领动画，再变更归属（写入新驻军 20k）
 *   await executeOrder({ order: 'attack', from: '156500000', to: '156450200' })
 *   await executeOrder({ order: 'cloud' })         // 云雾蒙太奇（时间流逝演出）
 */

import type { Container, Application } from 'pixi.js'
import { playArcAnimation, playScoutAnimation, startBattleAnimation, playCaptureAnimation } from './troopAnimation'
import type { BattleHandle } from './troopAnimation'
import { playCloudTransition, type CloudOptions } from './cloudTransition'
import { resolveLocation } from './locationResolver'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_COLORS } from '@/data/owners'

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

export type OrderType =
  | 'attack'
  | 'scout'
  | 'declareWar'
  | 'battle'
  | 'stopBattle'
  | 'stopBattles'
  | 'listBattles'
  | 'cloud'

export interface GameOrder {
  order: OrderType
  from?: string
  to?: string
  id?: string
  text?: string
}

// ─── 相机控制接口（由 LeafletMap 依赖注入）───
export interface CameraTarget {
  scale: number
  x: number
  y: number
}

export interface CameraController {
  /** 当前相机状态快照（用于演出后归位） */
  snapshot(): CameraTarget
  /** 锁定/解锁用户输入（演出期间防止滚轮/拖拽抢相机） */
  setLocked(v: boolean): void
  /** 放大并居中某地点 */
  focusOn(id: string, duration?: number): Promise<void>
  /** 保持缩放、平移到某地点（镜头跟随行军） */
  followTo(id: string, duration: number): Promise<void>
  /** 还原到指定相机状态 */
  reset(target: CameraTarget, duration?: number): Promise<void>
  /** 取消进行中的镜头补间并解锁（ESC / 快进跳过） */
  cancel(): void
}

// ─── 内部状态 ───

let _container: Container | null = null
let _camera: CameraController | null = null
let _app: Application | null = null
/** 镜头演出总开关：快进循环里应设为 false，避免每个事件都播 2-4s */
let cinematicEnabled = true

export function setCinematicEnabled(v: boolean): void {
  cinematicEnabled = v
}

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

export function init(container: Container, camera?: CameraController, app?: Application): void {
  _container = container
  _camera = camera ?? null
  _app = app ?? null
}

// ─── 五个游戏指令 ───

export async function attack(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.attack) return { ok: false, reason: '派兵动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 2000
  locks.attack = true
  try {
    if (_camera && cinematicEnabled) {
      // 镜头演出：放大 A → 跟随行军平移到 B → 演出后归位
      const before = _camera.snapshot()
      _camera.setLocked(true)
      await _camera.focusOn(from, 600)
      const follow = _camera.followTo(to, duration)
      await playArcAnimation({
        fromId: from,
        toId: to,
        container: _container,
        mode: 'dots',
        text: text || '出兵！',
        color: 0xffcc00,
        dots: 5,
        duration,
      })
      await follow
      await _camera.reset(before)
      _camera.setLocked(false)
    } else {
      await playArcAnimation({
        fromId: from,
        toId: to,
        container: _container,
        mode: 'dots',
        text: text || '出兵！',
        color: 0xffcc00,
        dots: 5,
        duration,
      })
    }
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

  const duration = 2000
  locks.war = true
  try {
    if (_camera && cinematicEnabled) {
      const before = _camera.snapshot()
      _camera.setLocked(true)
      await _camera.focusOn(from, 600)
      const follow = _camera.followTo(to, duration)
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
      await follow
      await _camera.reset(before)
      _camera.setLocked(false)
    } else {
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
    }
    return { ok: true }
  } finally {
    locks.war = false
  }
}

/**
 * 云雾蒙太奇（时间流逝演出）。
 * AI 可用它把「回合推进 / 政权重洗」等状态切换藏进雾里：
 *   await cloudTransition({ onMidpoint: () => setCurrentDate('1931-11-01') })
 * 快进模式下（cinematicEnabled=false）直接跳过，不阻塞事件流。
 */
export async function cloudTransition(opts?: CloudOptions): Promise<OrderResult> {
  if (!_app) return { ok: false, reason: 'gameOrders 未注入 PixiJS app' }
  if (!cinematicEnabled) return { ok: true }
  _camera?.setLocked(true)
  try {
    await playCloudTransition(_app, opts)
    return { ok: true }
  } finally {
    _camera?.setLocked(false)
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

  // 桥接：同步元数据进响应式 store，战斗面板自动刷新（经 applyEvent 进事件日志）
  useGameStore().applyEvent({
    type: 'battleStart',
    battleId: id,
    fromGb: from,
    targetGb: to,
    fromName: getLocationName(from),
    toName: getLocationName(to),
  })

  return { ok: true, id }
}

export function stopBattle(id: string): OrderResult {
  const entry = activeBattles.get(id)
  if (!entry) return { ok: false, reason: `战斗 ${id} 不存在` }

  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
  useGameStore().applyEvent({ type: 'battleEnd', battleId: id })
  return { ok: true }
}

export function stopBattles(): OrderResult {
  for (const [id, entry] of activeBattles) {
    entry.battle.stop()
    useGameStore().applyEvent({ type: 'battleEnd', battleId: id })
  }
  activeBattles.clear()
  battleRegistry.clear()
  return { ok: true }
}

/** 重置战斗运行时状态（读档/初始化时调用）。停止所有动画并清空模块级映射。 */
export function resetBattleRuntime(): void {
  for (const [, entry] of activeBattles) {
    entry.battle.stop()
  }
  activeBattles.clear()
  battleRegistry.clear()
  battleIdCounter = 0
}

export function listBattles(): BattleInfo[] {
  return useGameStore().battles.slice()
}

/**
 * 重建运行中的战斗动画（用于读档后恢复）。
 * 从 store.battles 中筛选 active=true 的条目，逐一重建 PixiJS 动画并注册到模块内部映射。
 * 不碰 store / applyEvent，保持 state 层纯净。
 */
export function restoreActiveAnimations(): void {
  // eslint-disable-next-line no-console
  console.log('[restoreActiveAnimations] 开始, _container=', !!_container, 'battles=', useGameStore().battles.length)
  if (!_container) return
  const store = useGameStore()
  for (const b of store.battles) {
    // eslint-disable-next-line no-console
    console.log('[restoreActiveAnimations] battle:', b.id, 'active=', b.active, 'from=', b.from, 'to=', b.to)
    if (!b.active) continue
    if (hasActiveBattle(b.from, b.to)) continue

    const anim = startBattleAnimation({
      fromId: b.from,
      toId: b.to,
      container: _container,
      colorA: 0x3b82f6,
      colorB: 0xef4444,
    })
    // eslint-disable-next-line no-console
    console.log('[restoreActiveAnimations] anim.graphics=', !!anim.graphics)
    if (!anim.graphics) continue

    battleRegistry.set(b.id, { from: b.from, to: b.to, fromName: b.fromName, toName: b.toName })
    activeBattles.set(b.id, { battle: anim })
  }
}

// ─── AI 世界状态写回接口（最小参数）───
// 这些 setter 是 AI 指令「落地」时回写 store 的入口：
// 只接收最少必要参数，不直接碰 PixiJS，也不处理动画。

/**
 * 占领功能（组合入口）：先播放占领动画，再提交状态变更。
 *
 * 1. 播放占领动画：在目标城高亮轮廓（新城主配色）+ 向外扩散圆环 + 弹字；
 *    有相机且处于普通演出模式（`cinematicEnabled`）时，先聚焦目标城、演完归位。
 * 2. 动画播完后再调 `captureCity`（→ applyEvent `capture`）变更城市归属（可选写入新驻军）。
 *
 * 语义：先动画、后 applyEvent（用户拍板）。快进（长跳蒙太奇）模式下跳过逐事件动画，
 * 由蒙太奇统一演出，但状态变更仍照常提交——"快进 ≠ 跳过动画"。
 *
 * @param gb          城市 gb 编码
 * @param owner       占领方政权（Owner 枚举，类型安全）
 * @param resultTroops 新驻军（可选，单位 k）；占领后由新城主入驻，不传则仅易主
 */
export async function capture(gb: string, owner: Owner, resultTroops?: number): Promise<OrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const color = OWNER_COLORS[owner]
  const duration = 1500

  // 1) 先播放占领动画
  if (cinematicEnabled) {
    if (_camera) {
      const before = _camera.snapshot()
      _camera.setLocked(true)
      try {
        await _camera.focusOn(gb, 500)
        await playCaptureAnimation({ targetId: gb, container: _container, color, text: '占领！', duration })
        await _camera.reset(before)
      } finally {
        _camera.setLocked(false)
      }
    } else {
      await playCaptureAnimation({ targetId: gb, container: _container, color, text: '占领！', duration })
    }
  }

  // 2) 动画播完（或快进省略动画）后再提交状态
  captureCity(gb, owner, resultTroops)
  return { ok: true }
}

/**
 * 占领/接收某城市（武力攻取或割让易主），经 Kernel（applyEvent）落地。
 * store.cities 是唯一写者，禁止直接赋值 ownership。
 * 割让时原势力撤军、新城主带入自己的兵——用 resultTroops 写入新驻军；
 * 不传 resultTroops 则仅易主、驻军保持不变。
 * @param gb          城市 gb 编码
 * @param owner       新的控制政权
 * @param resultTroops 新驻军（可选，单位 k）；割让/占领后由新城主入驻
 */
export function captureCity(gb: string, owner: Owner, resultTroops?: number): void {
  useGameStore().applyEvent({ type: 'capture', targetGb: gb, actor: owner, resultTroops })
}

/**
 * 设置某势力的存活状态。
 * 经 Kernel（applyEvent）落地——世界态唯一写者。
 * @param f     势力
 * @param alive true=加入存活列表，false=从存活列表移除（灭亡）
 */
export function setFactionAlive(f: Owner, alive: boolean): void {
  useGameStore().applyEvent({ type: 'setFactionAlive', faction: f, alive })
}

/**
 * 推进全局日期时钟。
 * 经 Kernel（applyEvent）落地——世界态唯一写者。
 * @param date ISO 格式日期字符串，如 '1931-10-01'
 */
export function setCurrentDate(date: string): void {
  useGameStore().applyEvent({ type: 'dateAdvance', date })
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
export async function executeOrder(
  json: GameOrder,
): Promise<OrderResult | BattleOrderResult | BattleListResult> {
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

    case 'cloud':
      // 云雾蒙太奇：盖住 → 停顿 → 揭开；可在暂停段藏状态切换（由 playCloudTransition 的 onMidpoint 处理）
      return cloudTransition()

    default:
      return { ok: false, reason: `未知指令: ${json.order}` }
  }
}
