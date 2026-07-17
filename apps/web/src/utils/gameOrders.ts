/**
 * 游戏指令层 —— AI / 指令统一入口
 *
 * 所有游戏意图（派兵、宣战、探察、战斗、占领、日期推进、势力存亡…）统一经
 * executeOrder({ order, ... }) 这一个 JSON 分发入口消费；AI 只需返回
 * { order, from, to, text }，不需要知道任何 Pixi.js 或容器细节。
 *
 * 各具体指令函数（attack/scout/declareWar/battle/capture/stopBattle/…）已降级为
 * 本模块内部实现，仅由 executeOrder 调用，外部请勿直接 import。
 *
 * 对外公开 API（仅以下符号）：
 *   init                  注入 PixiJS 容器 / 相机 / app（setup 用）
 *   resetBattleRuntime    清空战斗注册表（调试 / 重置用）
 *   restoreActiveAnimations  读档后重建战斗动画（load 用）
 *   executeOrder          ★ 唯一指令入口（AI 与 UI 都应走这里）
 *   playTimeJump          时间跳跃演出（云雾蒙太奇 + 推进日期，onMidpoint 改钟）
 *
 * 使用方式：
 *   import { init, resetBattleRuntime, restoreActiveAnimations, executeOrder } from '@/utils/gameOrders'
 *   init(worldContainer, cameraController, app)   // 第三个参数注入 PixiJS app（云雾蒙太奇需要）
 *   await executeOrder({ order: 'attack', from: '156500000', to: '156450200', text: '猛攻！' })
 *   await executeOrder({ order: 'capture', gb: '156450200', owner: Owner.KMT, resultTroops: 20 })  // 先播占领动画，再变更归属
 *   await executeOrder({ order: 'cloud' })         // 云雾蒙太奇（时间流逝演出）
 */

import type { Container, Application } from 'pixi.js'
import { playArcAnimation, playScoutAnimation, startBattleAnimation, playCaptureAnimation } from './troopAnimation'
import type { BattleHandle } from './troopAnimation'
import { playCloudTransition, type CloudOptions } from './cloudTransition'
import { resolveLocation, resolveLocationId } from './locationResolver'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_COLORS, OWNER_LABELS } from '@/data/owners'
import { useToast } from '@/composables/useToast'

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
  // 世界态写回（god-mode 调试 / 真实 agent 共用统一契约）
  | 'capture'
  | 'setFactionAlive'
  | 'setCurrentDate'
  | 'setCurrentFaction'

export interface GameOrder {
  order: OrderType
  from?: string
  to?: string
  id?: string
  text?: string
  // 世界态写回字段
  gb?: string // capture 目标城市 gb 编码
  owner?: Owner // capture 占领方
  resultTroops?: number // capture 新驻军（单位 k）
  faction?: Owner // setFactionAlive / setCurrentFaction 目标势力
  alive?: boolean // setFactionAlive：true=存活，false=灭亡
  date?: string // setCurrentDate：ISO 日期
  // 调度层可选字段（Agent-Kernel）：执行到此项后是否把控制权交还玩家
  needsPlayerDecision?: boolean
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
  /** 取消进行中的镜头补间并解锁（ESC 中断演出） */
  cancel(): void
}

// ─── 内部状态 ───

let _container: Container | null = null
let _camera: CameraController | null = null
let _app: Application | null = null

const locks: Record<string, boolean> = {
  attack: false,
  scout: false,
  war: false,
  battle: false,
}

const battleRegistry = new Map<string, BattleEntry>()
const activeBattles = new Map<string, BattleRuntime>()

let battleIdCounter = 0

// ─── 内部 helper ───

/**
 * 根据地点 id 解析展示用中文名。
 * 依次尝试 properties.name / NAME / name_local，全部缺失时回退为原始 id。
 * @param id 地点 id（gb 编码等）
 * @returns 展示名称；无法解析时返回原始 id
 */
function getLocationName(id: string): string {
  const f = resolveLocation(id)
  if (!f?.properties) return id
  return (f.properties.name || f.properties.NAME || f.properties.name_local || id) as string
}

/**
 * 判断指定方向（from → to）是否已存在进行中的战斗，避免重复注册。
 * @param from 出发城市 id
 * @param to   目标城市 id
 * @returns true=已存在该方向战斗
 */
function hasActiveBattle(from: string, to: string): boolean {
  for (const entry of battleRegistry.values()) {
    if (entry.from === from && entry.to === to) return true
  }
  return false
}

// ─── 初始化 ───

/**
 * 注入 PixiJS 容器 / 相机控制器 / 应用实例（由 LeafletMap 在 setup 时调用）。
 * 相机、应用实例可选：缺失时相关指令退化为「无镜头演出」的基础动画。
 * @param container 承载所有指令动画的 PixiJS 容器
 * @param camera    镜头控制器（聚焦/跟随/归位演出需要）
 * @param app       PixiJS Application 实例（云雾蒙太奇需要）
 */
export function init(container: Container, camera?: CameraController, app?: Application): void {
  _container = container
  _camera = camera ?? null
  _app = app ?? null
}

// ─── 五个游戏指令 ───

/**
 * 派兵动画：从 from 向 to 行军（黄色点阵弧线）。
 * 有相机且处于演出模式时，先放大 from、再跟随行军平移到 to、演完归位；
 * 否则直接播放点阵弧线动画（无镜头聚焦）。
 * 自带重入锁（locks.attack），演出期间再次调用会被拒绝。
 * @param from 出发城市 id（gb 编码）
 * @param to   目标城市 id
 * @param text 弹字文本，默认「出兵！」
 */
async function attack(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.attack) return { ok: false, reason: '派兵动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 2000
  locks.attack = true
  try {
    if (_camera) {
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

/**
 * 探察动画：以 from 为圆心的「雷达扫描」演出（旋转扫描扇区 + 扩散波环 +
 * 接触点闪现 + 中心信标脉冲）。单点扩散语义，无明确目的地，故不接收 to 参数。
 * 有相机且处于演出模式时，先聚焦 from、播完雷达扫描、再归位；
 * 否则直接播放基础雷达动画（无镜头聚焦）。自带重入锁（locks.scout）。
 * @param from 侦察中心城 id（gb 编码）
 * @param text 弹字文本，默认「侦察！」
 */
async function scout(from: string, text?: string): Promise<OrderResult> {
  if (locks.scout) return { ok: false, reason: '探察动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 1800
  locks.scout = true
  try {
    if (_camera) {
      const before = _camera.snapshot()
      _camera.setLocked(true)
      await _camera.focusOn(from, 600)
      await playScoutAnimation({
        fromId: from,
        container: _container,
        color: 0x22c55e,
        rings: 3,
        duration,
        text: text || '侦察！',
      })
      await _camera.reset(before)
      _camera.setLocked(false)
    } else {
      await playScoutAnimation({
        fromId: from,
        container: _container,
        color: 0x22c55e,
        rings: 3,
        duration,
        text: text || '侦察！',
      })
    }
    return { ok: true }
  } finally {
    locks.scout = false
  }
}

/**
 * 宣战动画：从 from 向 to 抛射红色光球并在落地处引爆（震波 ×3）。
 * 有相机且处于演出模式时，先聚焦 from、跟随光球到 to、演完归位；
 * 否则直接播放抛射+引爆动画（无镜头聚焦）。
 * 自带重入锁（locks.war），演出期间再次调用会被拒绝。
 * @param from 宣战国城 id（gb 编码）
 * @param to   目标国城 id
 * @param text 弹字文本，默认「宣战！」
 */
async function declareWar(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.war) return { ok: false, reason: '宣战动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 2000
  locks.war = true
  try {
    if (_camera) {
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
 */
async function cloudTransition(opts?: CloudOptions): Promise<OrderResult> {
  if (!_app) return { ok: false, reason: 'gameOrders 未注入 PixiJS app' }
  _camera?.setLocked(true)
  try {
    await playCloudTransition(_app, opts)
    return { ok: true }
  } finally {
    _camera?.setLocked(false)
  }
}

/**
 * 时间跳跃演出（云雾蒙太奇）。
 * 把「日期推进」藏进云雾：云盖满屏幕的那一刻（onMidpoint）才改日期，
 * 揭开后玩家看到的是新日期的世界。无 PixiJS app 时降级为直接推进日期。
 * @param date ISO 格式日期字符串，如 '1931-10-01'
 */
export async function playTimeJump(date: string): Promise<OrderResult> {
  let res: OrderResult
  if (!_app) {
    setCurrentDate(date) // 降级：无 app 时直接推进（如测试环境）
    res = { ok: true }
  } else {
    res = await cloudTransition({ onMidpoint: () => setCurrentDate(date) })
  }
  // 时间推进提示（顶部居中小条；与 executeOrder 的 setCurrentDate 走不同入口，不会重复）
  useToast().push({ icon: 'clock', tone: 'neutral', title: '时间推进', text: date })
  return res
}

/**
 * 注册一场持续战斗动画（from ↔ to 双向拉锯光束），并写回响应式战斗列表。
 * 交战光束先亮起（常驻动画），随后镜头演出参考 declareWar：聚焦出发城 →
 * 跟随行军到目标城 → 演完归位，带你“看一眼前线”；光束不依赖镜头、归位后仍常驻。
 * 同一方向已存在战斗时拒绝重复注册。
 * @param from 交战方 A 城 id
 * @param to   交战方 B 城 id
 * @returns 带战斗 id 的结果；坐标解析失败或重复时 ok=false
 */
async function battle(from: string, to: string, text?: string): Promise<BattleOrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }
  if (locks.battle) return { ok: false, reason: '战斗动画进行中' }

  if (hasActiveBattle(from, to)) {
    return { ok: false, reason: `已存在 ${from} → ${to} 的战斗` }
  }

  locks.battle = true
  try {
    // ① 先起交战动画（常驻光束，独立于镜头）
    const b = startBattleAnimation({
      fromId: from,
      toId: to,
      container: _container,
      colorA: 0x3b82f6,
      colorB: 0xef4444,
      text: text ?? `${getLocationName(from)} 与 ${getLocationName(to)} 交战`,
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

    // ② 镜头演出与交战并行：聚焦出发城 → 跟随行军到目标城 → 演完归位（参考 declareWar）
    if (_camera) {
      const before = _camera.snapshot()
      _camera.setLocked(true)
      await _camera.focusOn(from, 600)
      await _camera.followTo(to, 2000)
      await _camera.reset(before)
      _camera.setLocked(false)
    }

    return { ok: true, id }
  } finally {
    locks.battle = false
  }
}

/**
 * 停止指定战斗并清理运行时状态，同时广播 battleEnd 事件刷新战斗面板。
 * @param id 战斗 id（由 battle() 返回）
 * @returns 成功/失败原因
 */
function stopBattle(id: string): OrderResult {
  const entry = activeBattles.get(id)
  if (!entry) return { ok: false, reason: `战斗 ${id} 不存在` }

  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
  useGameStore().applyEvent({ type: 'battleEnd', battleId: id })
  return { ok: true }
}

/**
 * 停止全部进行中的战斗并清空战斗注册表。
 * @returns 始终成功
 */
function stopBattles(): OrderResult {
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

/**
 * 返回当前活动战斗列表的快照（来自响应式 store.battles）。
 * @returns 战斗信息数组
 */
function listBattles(): BattleInfo[] {
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
 *    有相机时先聚焦目标城、演完归位。
 * 2. 动画播完后再调 `captureCity`（→ applyEvent `capture`）变更城市归属（可选写入新驻军）。
 *
 * 语义：先动画、后 applyEvent（用户拍板）。
 *
 * @param gb          城市 gb 编码
 * @param owner       占领方政权（Owner 枚举，类型安全）
 * @param resultTroops 新驻军（可选，单位 k）；占领后由新城主入驻，不传则仅易主
 */
async function capture(gb: string, owner: Owner, resultTroops?: number): Promise<OrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const color = OWNER_COLORS[owner]
  const duration = 1500

  // 1) 先播放占领动画
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

  // 2) 动画播完后再提交状态
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
function captureCity(gb: string, owner: Owner, resultTroops?: number): void {
  useGameStore().applyEvent({ type: 'capture', targetGb: gb, actor: owner, resultTroops })
}

/**
 * 设置某势力的存活状态。
 * 经 Kernel（applyEvent）落地——世界态唯一写者。
 * @param f     势力
 * @param alive true=加入存活列表，false=从存活列表移除（灭亡）
 */
function setFactionAlive(f: Owner, alive: boolean): void {
  useGameStore().applyEvent({ type: 'setFactionAlive', faction: f, alive })
}

/**
 * 推进全局日期时钟。
 * 经 Kernel（applyEvent）落地——世界态唯一写者。
 * @param date ISO 格式日期字符串，如 '1931-10-01'
 */
function setCurrentDate(date: string): void {
  useGameStore().applyEvent({ type: 'dateAdvance', date })
}

/**
 * 设置玩家所选势力（委托给 store 内置的 selectFaction，避免逻辑分叉）。
 * @param f 玩家势力
 */
function setCurrentFaction(f: Owner): void {
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

  // 统一收集结果，switch 结束后单点弹窗（失败也弹，便于 PlayerAiPanel 看到原因）
  let result: OrderResult | BattleOrderResult | BattleListResult = { ok: false, reason: '未执行' }

  switch (json.order) {
    case 'attack': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `目标城市不存在: ${json.to}` }; break }
      result = await attack(fromId, toId, json.text)
      break
    }

    case 'scout': {
      const fromId = resolveLocationId(json.from!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      result = await scout(fromId, json.text)
      break
    }

    case 'declareWar': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `宣战国城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `目标国城市不存在: ${json.to}` }; break }
      result = await declareWar(fromId, toId, json.text)
      break
    }

    case 'battle': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `A 方城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `B 方城市不存在: ${json.to}` }; break }
      result = await battle(fromId, toId, json.text)
      break
    }

    case 'stopBattle':
      result = stopBattle(json.id!)
      break

    case 'stopBattles':
      result = stopBattles()
      break

    case 'listBattles':
      result = { ok: true, battles: listBattles() }
      break

    case 'cloud':
      // 云雾蒙太奇：盖住 → 停顿 → 揭开；可在暂停段藏状态切换（由 playCloudTransition 的 onMidpoint 处理）
      result = await cloudTransition()
      break

    // ── 世界态写回（无动画，直接经 Kernel applyEvent 落地）──
    case 'capture': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      // 占领（含动画）：gb/owner 必填，resultTroops 可选
      result = await capture(gbId, json.owner!, json.resultTroops)
      break
    }

    case 'setFactionAlive':
      setFactionAlive(json.faction!, json.alive!)
      result = { ok: true }
      break

    case 'setCurrentDate':
      setCurrentDate(json.date!)
      result = { ok: true }
      break

    case 'setCurrentFaction':
      setCurrentFaction(json.faction!)
      result = { ok: true }
      break

    default:
      result = { ok: false, reason: `未知指令: ${json.order}` }
      break
  }

  // 单点触发提示（replay 安全：executeOrder 只在活指令里被调用）
  popToast(json, result)
  return result
}

/**
 * 提示分发：根据指令类型与执行结果，向 ToastStack 推送一条提示。
 * 仅在 executeOrder 尾端调用一次（单点触发）。
 * @param json   原始指令（含 AI 给的 text / 城市 / 势力等上下文，文案最丰富）
 * @param result 执行结果（ok=false 时统一走错误提示）
 */
function popToast(
  json: GameOrder,
  result: OrderResult | BattleOrderResult | BattleListResult,
): void {
  const { push } = useToast()

  // 失败类：统一错误提示（参数校验失败 / 重入锁 / 未知指令 / 动画创建失败）
  if (!result.ok) {
    push({
      icon: 'alert-triangle',
      tone: 'error',
      title: '指令失败',
      text: result.reason ?? '未知错误',
    })
    return
  }

  const fname = (o?: Owner): string =>
    o != null ? ((OWNER_LABELS as Record<string, string>)[o] ?? o) : ''

  switch (json.order) {
    case 'attack': {
      const t = `${getLocationName(json.from!)} ⇢ ${getLocationName(json.to!)}`
      push({ icon: 'sword', tone: 'amber', title: '出兵', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'scout': {
      const t = `${getLocationName(json.from!)} 派出斥候`
      push({ icon: 'eye', tone: 'blue', title: '侦察', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'declareWar': {
      const t = `${getLocationName(json.from!)} 对 ${getLocationName(json.to!)} 宣战`
      push({ icon: 'flag', tone: 'cinnabar', title: '宣战', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'battle': {
      const t = `${getLocationName(json.from!)} 与 ${getLocationName(json.to!)} 交战`
      push({ icon: 'crosshair', tone: 'cinnabar', title: '开战', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'stopBattle':
      push({ icon: 'player-stop', tone: 'neutral', title: '停战', text: '战斗结束' })
      break
    case 'stopBattles':
      push({ icon: 'player-stop', tone: 'neutral', title: '停战', text: '全线停战' })
      break
    case 'capture': {
      const ownerName = fname(json.owner)
      const troop = json.resultTroops != null ? `（驻军 ${json.resultTroops}k）` : ''
      push({
        icon: 'flag',
        tone: 'cinnabar',
        title: '占领',
        text: `${getLocationName(json.gb!)} → ${ownerName}${troop}`,
      })
      break
    }
    case 'setFactionAlive': {
      const fName = fname(json.faction)
      if (json.alive) {
        push({ icon: 'crown', tone: 'purple', title: '参战', text: `${fName} 加入战局` })
      } else {
        push({ icon: 'skull', tone: 'error', title: '覆灭', text: `${fName} 势力覆灭` })
      }
      break
    }
    case 'setCurrentDate':
      push({ icon: 'clock', tone: 'neutral', title: '时间推进', text: json.date ?? '' })
      break
    // cloud / setCurrentFaction / listBattles：不在此弹（云雾是视觉本身；setCurrentFaction 经 store.selectFaction 弹择势）
    default:
      break
  }
}
