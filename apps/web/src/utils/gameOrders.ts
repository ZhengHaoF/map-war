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
 *   await executeOrder({ order: 'arrowFly', from: '156500000', to: '156450200', text: '猛攻！' })
 *   await executeOrder({ order: 'capture', gb: '156450200', owner: Owner.KMT, resultTroops: 20 })  // 先播占领动画，再变更归属
 *   await executeOrder({ order: 'fogCover' })       // 云雾蒙太奇（时间流逝演出）
 */

import type { Container, Application } from 'pixi.js'
import { playArcAnimation, playScoutAnimation, startBattleAnimation, playCaptureAnimation, playDevelopAnimation } from './troopAnimation'
import type { BattleHandle } from './troopAnimation'
import { playCloudTransition, type CloudOptions } from './cloudTransition'
import { resolveLocation, resolveLocationId, distanceBetween } from './locationResolver'
import { useGameStore } from '@/stores/game'
import type { BattleInfo, CityStatField } from '@/stores/game'
import { DEVELOP_FIELDS } from '@/stores/game'
import { Owner, OWNER_COLORS, OWNER_LABELS } from '@/data/owners'
import { getDisplayName } from '@/data/displayNames'
import { useToast } from '@/composables/useToast'
import { computeActionCost, marchCost } from '@/utils/economy'

// ─── 类型定义 ───

export interface OrderResult {
  ok: boolean
  reason?: string
  /** 内政指令的实际消耗（用于 toast 展示；与 applyDomesticCost 扣款同源） */
  cost?: { silver: number; food: number }
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

/** 全部合法指令（唯一真相源，aiOrderContract 等模块从此 import）。 */
export const ORDER_TYPES = [
  'arrowFly',
  'radarPulse',
  'orbBurst',
  'battle',
  'stopBattle',
  'listBattles',
  'fogCover',
  // 世界态写回（god-mode 调试 / 真实 agent 共用统一契约）
  'capture',
  'setFactionAlive',
  'setCurrentDate',
  'setCurrentFaction',
  'moveTroops',
  // 战斗生命周期
  'deploy',
  // 内政 / 建设（生产、筑防、整军——世界态写回）
  'recruit',
  'develop',
  'fortify',
  'rally',
] as const

export type OrderType = (typeof ORDER_TYPES)[number]

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
  // 调兵：从 from 搬运到 to 的兵力（单位 k），须为正数
  amount?: number
  // 战斗：撤退相关
  reason?: string // stopBattle 结束原因（retreat/peace/surrender）
  retreatLoss?: number // stopBattle(reason:'retreat') 时追击减员（k）
  deployAmount?: number // battle 时同时 deploy 的兵力
  // 内政：develop 指定调整字段（industry / food）；recruit 用 amount，fortify 用 amount，rally 用 amount 作士气增量
  field?: CityStatField
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
  arrow: false,
  radar: false,
  orb: false,
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
  const histName = getDisplayName(id)
  if (histName) return histName
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

/**
 * 生成下一个战斗 id（格式 `battle_N`，自增）。
 * 防冲突：resetBattleRuntime 会把计数器归零（读档/重置/resize/手动刷新都会触发），
 * 但 store.battles 里可能残留历史战斗 id（含已 inactive 的）。若计数器从 0 重排，
 * 新战斗可能撞上残留 id，导致 stopBattle/裁决官按 id 查找时命中错误条目。
 * 故生成前先扫描 store.battles，把计数器抬到「现存最大编号」之上再自增。
 */
function nextBattleId(): string {
  let max = 0
  for (const b of useGameStore().battles) {
    const m = /^battle_(\d+)$/.exec(b.id)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  if (battleIdCounter < max) battleIdCounter = max
  return `battle_${++battleIdCounter}`
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

// ─── 动画 / 演出函数（纯视觉，不改世界态）───

/**
 * 箭头飞行动画：从 from 向 to（黄色点阵弧线）。
 * 有相机且处于演出模式时，先放大 from、再跟随行军平移到 to、演完归位；
 * 否则直接播放点阵弧线动画（无镜头聚焦）。
 * 自带重入锁（locks.arrow），演出期间再次调用会被拒绝。
 * @param from 出发城市 id（gb 编码）
 * @param to   目标城市 id
 * @param text 弹字文本，默认「出兵！」
 */
async function arrowFly(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.arrow) return { ok: false, reason: '箭头动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 2000
  locks.arrow = true
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
        color: 0x5c4426,
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
        color: 0x5c4426,
        dots: 5,
        duration,
      })
    }
    return { ok: true }
  } finally {
    locks.arrow = false
  }
}

/**
 * 雷达脉冲动画：以 from 为圆心的「雷达扫描」演出（旋转扫描扇区 + 扩散波环 +
 * 接触点闪现 + 中心信标脉冲）。单点扩散语义，无明确目的地，故不接收 to 参数。
 * 有相机且处于演出模式时，先聚焦 from、播完雷达扫描、再归位；
 * 否则直接播放基础雷达动画（无镜头聚焦）。自带重入锁（locks.radar）。
 * @param from 扫描中心城 id（gb 编码）
 * @param text 弹字文本，默认「侦察！」
 */
async function radarPulse(from: string, text?: string): Promise<OrderResult> {
  if (locks.radar) return { ok: false, reason: '雷达脉冲动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 1800
  locks.radar = true
  try {
    if (_camera) {
      const before = _camera.snapshot()
      _camera.setLocked(true)
      await _camera.focusOn(from, 600)
      await playScoutAnimation({
        fromId: from,
        container: _container,
        color: 0x54939c,
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
        color: 0x54939c,
        rings: 3,
        duration,
        text: text || '侦察！',
      })
    }
    return { ok: true }
  } finally {
    locks.radar = false
  }
}

/**
 * 光球爆炸动画：从 from 向 to 抛射红色光球并在落地处引爆（震波 ×3）。
 * 有相机且处于演出模式时，先聚焦 from、跟随光球到 to、演完归位；
 * 否则直接播放抛射+引爆动画（无镜头聚焦）。
 * 自带重入锁（locks.orb），演出期间再次调用会被拒绝。
 * @param from 抛射起点城 id（gb 编码）
 * @param to   目标城 id
 * @param text 弹字文本，默认「宣战！」
 */
async function orbBurst(from: string, to: string, text?: string): Promise<OrderResult> {
  if (locks.orb) return { ok: false, reason: '光球爆炸动画进行中' }
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const duration = 2000
  locks.orb = true
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
        color: 0xb04a3a,
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
        color: 0xb04a3a,
        duration: 1200,
        explosionDuration: 800,
      })
    }
    return { ok: true }
  } finally {
    locks.orb = false
  }
}

/**
 * 云雾遮罩蒙太奇（时间流逝演出）。
 * 把状态切换藏进雾里：
 *   await fogCover({ onMidpoint: () => useGameStore().applyEvent({ type: 'dateAdvance', date: '1931-11-01' }) })
 */
async function fogCover(opts?: CloudOptions): Promise<OrderResult> {
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
    // 降级：无 app 时直接推进（如测试环境）；dateAdvance 无前置校验依赖，不需检返回值
    useGameStore().applyEvent({ type: 'dateAdvance', date })
    res = { ok: true }
  } else {
    res = await fogCover({
      onMidpoint: () => {
        // 闭包：onMidpoint: () => void；忽略返回值（dateAdvance 必成功）
        useGameStore().applyEvent({ type: 'dateAdvance', date })
      },
    })
  }
  // 时间推进提示（顶部居中小条）
  useToast().push({ icon: 'clock', tone: 'neutral', title: '时间推进', text: date })
  return res
}

/**
 * 注册一场持续战斗动画（from ↔ to 双向拉锯光束），动画运行时登记在本地注册表；
 * 交战光束先亮起（常驻动画），随后镜头演出参考 declareWar：聚焦出发城 →
 * 跟随行军到目标城 → 演完归位，带你“看一眼前线”；光束不依赖镜头、归位后仍常驻。
 * 同一方向已存在战斗时拒绝重复注册。
 * @param from 交战方 A 城 id
 * @param to   交战方 B 城 id
 * @returns 带战斗 id 的结果；坐标解析失败或重复时 ok=false
 */
// ─── 战斗动画（纯视觉，世界态由 executeOrder 落）───
async function battle(from: string, to: string, text?: string): Promise<BattleOrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }
  if (locks.battle) return { ok: false, reason: '战斗动画进行中' }

  if (hasActiveBattle(from, to)) {
    return { ok: false, reason: `已存在 ${from} → ${to} 的战斗` }
  }

  locks.battle = true
  try {
    // ① 起交战动画（常驻光束，独立于镜头）
    const b = startBattleAnimation({
      fromId: from,
      toId: to,
      container: _container,
      colorA: 0x5f7fa6,
      colorB: 0xb25144,
      text: text ?? `${getLocationName(from)} 与 ${getLocationName(to)} 交战`,
    })

    if (!b.graphics) {
      return { ok: false, reason: '战斗动画创建失败（无法解析坐标）' }
    }

    const id = nextBattleId()

    battleRegistry.set(id, {
      from,
      to,
      fromName: getLocationName(from),
      toName: getLocationName(to),
    })

    activeBattles.set(id, { battle: b })

    // ② 镜头演出：聚焦出发城 → 跟随行军到目标城 → 演完归位（参考 declareWar）。
    // 注意：世界态登记（battleStart）由 executeOrder 在动画后统一 applyEvent，本函数只负责画面。
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
 * 停止指定战斗的动画并清理运行时状态（灭光束）。
 * 世界态（battleEnd 事件）由 executeOrder 在调用本函数后统一 applyEvent。
 * @param id 战斗 id（由 battle() 返回）
 * @returns 成功/失败原因
 */
function stopBattle(id: string): OrderResult {
  const entry = activeBattles.get(id)
  if (!entry) return { ok: false, reason: `战斗 ${id} 不存在` }

  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
  // 世界态（battleEnd）由 executeOrder 在灭光束后统一 applyEvent，本函数只负责画面
  return { ok: true }
}

/**
 * 按 id 灭光柱并清理动画层注册表（幂等：id 不存在则静默跳过）。
 * 仅清理画面层，不碰世界态（battleEnd 事件由调用方独立 apply）。
 *
 * 使用场景：战斗经由 world-state 结算路径（如 settleActiveBattles）结束时，
 * 绕过 executeOrder 直调 applyEvent('battleEnd')，需同步灭光柱。
 */
export function stopBattleVisual(id: string): void {
  const entry = activeBattles.get(id)
  if (!entry) return // 幂等：动画本就不在运行，无需报错阻断
  entry.battle.stop()
  activeBattles.delete(id)
  battleRegistry.delete(id)
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
      colorA: 0x5f7fa6,
      colorB: 0xb25144,
    })
    // eslint-disable-next-line no-console
    console.log('[restoreActiveAnimations] anim.graphics=', !!anim.graphics)
    if (!anim.graphics) continue

    battleRegistry.set(b.id, { from: b.from, to: b.to, fromName: b.fromName, toName: b.toName })
    activeBattles.set(b.id, { battle: anim })
  }
}

// ─── 占领动画（纯视觉，世界态由 executeOrder 落）───
async function capture(gb: string, owner: Owner): Promise<OrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }

  const color = OWNER_COLORS[owner]
  const duration = 1500

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

  return { ok: true }
}

// ─── 内政 / 建设动画（纯视觉，世界态由 executeOrder 落）───
/**
 * 内政建设演出：镜头聚焦目标城 → 播轻量建设动画（轮廓脉冲+扩散环+飘字）→ 归位。
 * 四类内政指令（recruit/develop/fortify/rally）共用本函数，仅 color/text 不同。
 * 世界态写回（produce / cityStatChange / moraleChange）由 executeOrder 在动画后统一 applyEvent。
 * @param gb     目标城市 id（已解析的 gb 编码）
 * @param color  飘字与脉冲主色（征兵红 / 建设金 / 筑防灰 / 整军绿）
 * @param text   飘字文本（如 "+5k 兵" / "+2 工业"）
 */
async function developCity(gb: string, color: number, text: string): Promise<OrderResult> {
  if (!_container) return { ok: false, reason: 'gameOrders 未初始化' }
  const duration = 1100

  if (_camera) {
    const before = _camera.snapshot()
    _camera.setLocked(true)
    try {
      await _camera.focusOn(gb, 500)
      await playDevelopAnimation({ targetId: gb, container: _container, color, text, duration })
      await _camera.reset(before)
    } finally {
      _camera.setLocked(false)
    }
  } else {
    await playDevelopAnimation({ targetId: gb, container: _container, color, text, duration })
  }

  return { ok: true }
}

/** 内政飘字配色与文案 */
const DEVELOP_COLORS = {
  recruit: 0xe24b4a, // 征兵：红
  develop: 0xef9f27, // 建设：金
  fortify: 0x888780, // 筑防：灰
  rally: 0x639922, // 整军：绿
} as const

/** develop field → 中文名（飘字用） */
const FIELD_LABELS: Record<CityStatField, string> = {
  industry: '工业',
  food: '粮食',
  fort: '工事',
  cityLevel: '规模',
}

// ─── 指令编排层：executeOrder（世界态唯一落地点）───
// 内部动画函数只负责画面，所有世界态（capture / battleStart / battleEnd / setFactionAlive /
// dateAdvance / selectFaction）统一由 executeOrder 在动画播完后 applyEvent 落地。

/**
 * 内政指令的经济前置检查（征兵/建设/筑防/整军）。
 * 付费主体 = 目标城的 owner（内政指令目标城必为己方，校验层已保证）。
 *
 * 流程：
 * 1. 算一次性成本（银/粮）
 * 2. 校验余额是否足够，不足则返回 { ok:false, reason }
 * 3. 足够则 applyEvent 扣款（treasuryChange / granaryChange），落库
 *
 * @param faction 付费势力（目标城 owner）
 * @param order   指令类型
 * @param amount  数量（征兵 k / 建设点 / 工事点；rally 忽略）
 */
function applyDomesticCost(
  faction: Owner,
  order: 'recruit' | 'develop' | 'fortify' | 'rally',
  amount: number,
): OrderResult {
  const store = useGameStore()
  const cost = computeActionCost(order, amount)
  // 银库不足（getTreasury 缺省 0 时亦按余额判定，老存档/测试环境兼容）
  if (store.getTreasury(faction) < cost.silver) {
    return { ok: false, reason: `饷银不足（需 ${cost.silver} 万银，余 ${store.getTreasury(faction)} 万银）` }
  }
  // 粮仓不足（仅征兵耗粮）
  if (cost.food > 0 && store.getGranary(faction) < cost.food) {
    return { ok: false, reason: `粮草不足（需 ${cost.food} 万石，余 ${store.getGranary(faction)} 万石）` }
  }
  // 扣款
  if (cost.silver > 0) {
    store.applyEvent({ type: 'treasuryChange', faction, delta: -cost.silver, reason: `内政·${order}` })
  }
  if (cost.food > 0) {
    store.applyEvent({ type: 'granaryChange', faction, delta: -cost.food, reason: `征兵·${order}` })
  }
  return { ok: true }
}

/**
 * 行军成本检查 + 扣除（远征消耗）。
 * 先算距离 → 算银/粮成本 → 检查余额 → 扣款。
 * 距离计算失败（如 locationResolver 未初始化）时静默放行，不阻塞行军。
 */
function applyMarchCost(
  fromId: string,
  toId: string,
  troopsK: number,
): OrderResult {
  const dist = distanceBetween(fromId, toId)
  if (dist === null) return { ok: true } // 容错放行
  const cost = marchCost(dist, troopsK)
  const store = useGameStore()
  const fromCity = store.cities[fromId]
  const faction = (fromCity?.owner as Owner) ?? Owner.NEUTRAL
  if (cost.silver > 0 && store.getTreasury(faction) < cost.silver) {
    return { ok: false, reason: `远征饷银不足（需 ${cost.silver} 万银，余 ${store.getTreasury(faction)} 万银）` }
  }
  if (cost.food > 0 && store.getGranary(faction) < cost.food) {
    return { ok: false, reason: `远征粮草不足（需 ${cost.food} 万石，余 ${store.getGranary(faction)} 万石）` }
  }
  if (cost.silver > 0) {
    store.applyEvent({ type: 'treasuryChange', faction, delta: -cost.silver })
  }
  if (cost.food > 0) {
    store.applyEvent({ type: 'granaryChange', faction, delta: -cost.food })
  }
  // toast 提示（关键 cost > 0 才播，避免零成本噪音）
  if (cost.silver > 0 || cost.food > 0) {
    const parts: string[] = []
    if (cost.silver > 0) parts.push(`${cost.silver} 万银`)
    if (cost.food > 0) parts.push(`${cost.food} 万石`)
    useToast().push({
      icon: 'route',
      tone: 'amber',
      title: `行军消耗（${Math.round(dist!)} km）`,
      text: parts.join(' · '),
      duration: 3000,
    })
  }
  return { ok: true }
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
    case 'arrowFly': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `目标城市不存在: ${json.to}` }; break }
      result = await arrowFly(fromId, toId, json.text)
      break
    }

    case 'radarPulse': {
      const fromId = resolveLocationId(json.from!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      result = await radarPulse(fromId, json.text)
      break
    }

    case 'orbBurst': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `起点城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `目标城市不存在: ${json.to}` }; break }
      result = await orbBurst(fromId, toId, json.text)
      break
    }

    case 'battle': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `A 方城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `B 方城市不存在: ${json.to}` }; break }
      // 守卫式自动出兵：显式指定量 > 已有外出兵力 > 兜底全驻军
      const store = useGameStore()
      const preFrom0 = store.cities[fromId]
      const autoDeploy =
        json.deployAmount != null && json.deployAmount > 0
          ? json.deployAmount                      // ① 显式指定 → 用该量
          : (preFrom0?.fieldForce ?? 0) > 0
            ? 0                                     // ② 已有部署 → 不抽兵（尊重预部署 / 守家留兵）
            : (preFrom0?.troops ?? 0)               // ③ 兜底：fieldForce 与驻军皆空则 0
      if (autoDeploy > 0) {
        const dr = store.applyEvent({ type: 'deploy', fromGb: fromId, amount: autoDeploy })
        if (!dr.ok) { result = { ok: false, reason: `出兵失败: ${dr.reason}` }; break }
        // 告知玩家自动出兵量（独立 toast：battle 的 popToast 分支不携带 deploy 量，此处显式告知）
        useToast().push({ icon: 'sword', tone: 'cinnabar', title: '出兵', text: `${getLocationName(fromId)} 出兵 ${autoDeploy}k（驻军转外出）` })
      }
      // 前置检查：来源城必须有外出兵力，否则不得立战线
      const preFrom = store.cities[fromId]
      if (!preFrom || preFrom.fieldForce <= 0) {
        result = { ok: false, reason: `${getLocationName(fromId)} 无可战之兵（驻军与外出均为 0），无法开战` }
        break
      }
      // 行军成本：远征耗银/粮（不足则拒绝行军）
      const marchChk = applyMarchCost(fromId, toId, autoDeploy || preFrom.fieldForce)
      if (!marchChk.ok) { result = marchChk; break }
      const r = await battle(fromId, toId, json.text)
      if (!r.ok) { result = r; break }
      // 确定攻守双方（攻方 = 来源城 owner，守方 = 目标城 owner）
      const fromCity = store.cities[fromId]
      const toCity = store.cities[toId]
      const attacker: Owner = (fromCity?.owner as Owner) ?? Owner.NEUTRAL
      const defender: Owner = (toCity?.owner as Owner) ?? Owner.NEUTRAL
      // 动画播完后，由唯一写者登记战斗（battleStart）
      store.applyEvent({
        type: 'battleStart',
        battleId: r.id!,
        fromGb: fromId,
        targetGb: toId,
        fromName: getLocationName(fromId),
        toName: getLocationName(toId),
        attacker: attacker ?? Owner.NEUTRAL,
        defender: defender ?? Owner.NEUTRAL,
      })
      result = r
      break
    }

    case 'stopBattle': {
      // 调试日志：排查 AI 返回不存在的战斗 ID
      const store = useGameStore()
      const requestedId = json.id!
      const existsInActiveBattles = activeBattles.has(requestedId)
      const existsInStoreBattles = store.battles.some(b => b.id === requestedId)
      const activeBattleIds = Array.from(activeBattles.keys())
      const storeBattleIds = store.battles.map(b => b.id)
      // eslint-disable-next-line no-console
      console.log('[stopBattle] AI请求停止战斗:', {
        requestedId,
        existsInActiveBattles,
        existsInStoreBattles,
        activeBattleIds,
        storeBattleIds,
        reason: json.reason,
      })
      if (!existsInActiveBattles) {
        // eslint-disable-next-line no-console
        console.warn('[stopBattle] 战斗不在 activeBattles 注册表中，可能已被其他路径结束')
      }

      const r = stopBattle(requestedId)
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn('[stopBattle] 执行失败，跳过 applyEvent:', r.reason)
        result = r
        break
      }
      // 灭光束后，由唯一写者结束战斗（battleEnd），携带 reason + 撤退追击减员
      store.applyEvent({
        type: 'battleEnd',
        battleId: requestedId,
        reason: (json.reason as 'retreat' | 'peace' | undefined),
        retreatLoss: json.retreatLoss,
      })
      result = r
      break
    }

    case 'listBattles':
      result = { ok: true, battles: listBattles() }
      break

    case 'fogCover':
      // 云雾遮罩：盖住 → 停顿 → 揭开；可在暂停段藏状态切换（由 playCloudTransition 的 onMidpoint 处理）
      result = await fogCover()
      break

    // ── 世界态写回（动画已在上面各 case 播完，这里统一经 Kernel applyEvent 落地）──
    case 'capture': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      // 先播占领动画，播完再由唯一写者易主（gb/owner 必填，resultTroops 可选）
      await capture(gbId, json.owner!)
      const r = useGameStore().applyEvent({
        type: 'capture',
        targetGb: gbId,
        actor: json.owner!,
        resultTroops: json.resultTroops,
      })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true }
      break
    }

    case 'moveTroops': {
      const fromId = resolveLocationId(json.from!)
      const toId = resolveLocationId(json.to!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      if (!toId) { result = { ok: false, reason: `目标城市不存在: ${json.to}` }; break }
      if (typeof json.amount !== 'number' || json.amount <= 0) {
        result = { ok: false, reason: 'amount 必须是正数（单位 k）' }
        break
      }
      // 行军成本：远征调兵耗银/粮
      const marchChk = applyMarchCost(fromId, toId, json.amount)
      if (!marchChk.ok) { result = marchChk; break }
      // 复用 arrowFly 行军演出（黄点弧线），演完再落地（与 capture 同构）
      await arrowFly(fromId, toId, json.text || '调兵！')
      const r = useGameStore().applyEvent({ type: 'moveTroops', fromGb: fromId, toGb: toId, amount: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true }
      break
    }

    // ── 战斗生命周期：deploy（出兵）──
    case 'deploy': {
      const fromId = resolveLocationId(json.from!)
      if (!fromId) { result = { ok: false, reason: `出发城市不存在: ${json.from}` }; break }
      if (typeof json.amount !== 'number' || json.amount <= 0) {
        result = { ok: false, reason: 'amount 必须是正数（单位 k）' }
        break
      }
      // 出兵：直接 apply（演出由调用方/上下文覆盖，本地只记录 toast）
      const r = useGameStore().applyEvent({ type: 'deploy', fromGb: fromId, amount: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true }
      break
    }

    // ── 内政 / 建设（先播建设动画，再经 Kernel applyEvent 落地）──
    case 'recruit': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      if (typeof json.amount !== 'number' || json.amount <= 0) {
        result = { ok: false, reason: 'amount 必须是正数（单位 k）' }
        break
      }
      // 经济前置：征兵耗银 + 粮，付费主体 = 目标城 owner
      const payFaction = useGameStore().cities[gbId]?.owner as Owner
      const costChk = applyDomesticCost(payFaction, 'recruit', json.amount)
      if (!costChk.ok) { result = costChk; break }
      await developCity(gbId, DEVELOP_COLORS.recruit, `+${json.amount}k 兵`)
      const r = useGameStore().applyEvent({ type: 'produce', targetGb: gbId, amount: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true, cost: computeActionCost('recruit', json.amount) }
      break
    }

    case 'develop': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      const field = json.field
      if (!field || !DEVELOP_FIELDS.includes(field)) {
        result = { ok: false, reason: `field 必须是 ${DEVELOP_FIELDS.join(' / ')}（收到: ${String(field)}）` }
        break
      }
      if (typeof json.amount !== 'number' || json.amount <= 0) {
        result = { ok: false, reason: 'amount 必须是正数' }
        break
      }
      // 经济前置：建设耗银
      const payFaction = useGameStore().cities[gbId]?.owner as Owner
      const costChk = applyDomesticCost(payFaction, 'develop', json.amount)
      if (!costChk.ok) { result = costChk; break }
      await developCity(gbId, DEVELOP_COLORS.develop, `+${json.amount} ${FIELD_LABELS[field]}`)
      const r = useGameStore().applyEvent({ type: 'cityStatChange', targetGb: gbId, field, delta: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true, cost: computeActionCost('develop', json.amount) }
      break
    }

    case 'fortify': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      if (typeof json.amount !== 'number' || json.amount <= 0) {
        result = { ok: false, reason: 'amount 必须是正数' }
        break
      }
      // 经济前置：筑防耗银
      const payFaction = useGameStore().cities[gbId]?.owner as Owner
      const costChk = applyDomesticCost(payFaction, 'fortify', json.amount)
      if (!costChk.ok) { result = costChk; break }
      await developCity(gbId, DEVELOP_COLORS.fortify, `+${json.amount} 工事`)
      const r = useGameStore().applyEvent({ type: 'cityStatChange', targetGb: gbId, field: 'fort', delta: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true, cost: computeActionCost('fortify', json.amount) }
      break
    }

    case 'rally': {
      const gbId = resolveLocationId(json.gb!)
      if (!gbId) { result = { ok: false, reason: `目标城市不存在: ${json.gb}` }; break }
      if (typeof json.amount !== 'number' || json.amount === 0) {
        result = { ok: false, reason: 'amount 必须是非零数字（士气增量，可正可负）' }
        break
      }
      // 经济前置：整军耗银（固定，不论增量大小）
      const payFaction = useGameStore().cities[gbId]?.owner as Owner
      const costChk = applyDomesticCost(payFaction, 'rally', Math.abs(json.amount))
      if (!costChk.ok) { result = costChk; break }
      const sign = json.amount > 0 ? '+' : ''
      await developCity(gbId, DEVELOP_COLORS.rally, `${sign}${json.amount} 士气`)
      const r = useGameStore().applyEvent({ type: 'moraleChange', targetGb: gbId, delta: json.amount })
      if (!r.ok) { result = { ok: false, reason: r.reason! }; break }
      result = { ok: true, cost: computeActionCost('rally', Math.abs(json.amount)) }
      break
    }

    case 'setFactionAlive':
      useGameStore().applyEvent({ type: 'setFactionAlive', faction: json.faction!, alive: json.alive! })
      result = { ok: true }
      break

    case 'setCurrentDate':
      useGameStore().applyEvent({ type: 'dateAdvance', date: json.date! })
      result = { ok: true }
      break

    case 'setCurrentFaction':
      useGameStore().selectFaction(json.faction!)
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

  // 内政指令成本后缀（仅在 result.cost 存在且有消耗时追加）
  const costSuffix = (() => {
    const c = result.cost
    if (!c) return ''
    const parts: string[] = []
    if (c.silver > 0) parts.push(`耗银${c.silver}万`)
    if (c.food > 0) parts.push(`耗粮${c.food}万石`)
    return parts.length ? `（${parts.join(' · ')}）` : ''
  })()

  switch (json.order) {
    case 'arrowFly': {
      const t = `${getLocationName(json.from!)} ⇢ ${getLocationName(json.to!)}`
      push({ icon: 'sword', tone: 'amber', title: '出兵', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'radarPulse': {
      const t = `${getLocationName(json.from!)} 派出斥候`
      push({ icon: 'eye', tone: 'blue', title: '侦察', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'orbBurst': {
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
      if (json.reason === 'retreat') {
        push({ icon: 'player-stop', tone: 'neutral', title: '撤退', text: json.text ?? '我军收兵回城' })
      } else if (json.reason === 'peace') {
        push({ icon: 'affiliate', tone: 'green', title: '议和', text: json.text ?? '双方罢兵言和' })
      } else {
        push({ icon: 'player-stop', tone: 'neutral', title: '停战', text: '战斗结束' })
      }
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
    case 'moveTroops': {
      const t = `${getLocationName(json.from!)} ⇢ ${getLocationName(json.to!)}（${json.amount ?? 0}k）`
      push({ icon: 'sword', tone: 'amber', title: '调兵', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'deploy': {
      const t = `${getLocationName(json.from!)} 出兵 ${json.amount ?? 0}k`
      push({ icon: 'sword', tone: 'cinnabar', title: '出兵', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'recruit': {
      const t = `${getLocationName(json.gb!)} 征兵 ${json.amount ?? 0}k${costSuffix}`
      push({ icon: 'sword', tone: 'cinnabar', title: '征兵', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'develop': {
      const fieldLabel = json.field ? FIELD_LABELS[json.field] : ''
      const t = `${getLocationName(json.gb!)} ${fieldLabel} +${json.amount ?? 0}${costSuffix}`
      push({ icon: 'crown', tone: 'amber', title: '建设', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'fortify': {
      const t = `${getLocationName(json.gb!)} 修筑工事 +${json.amount ?? 0}${costSuffix}`
      push({ icon: 'flag', tone: 'neutral', title: '筑防', text: json.text ? `${json.text} · ${t}` : t })
      break
    }
    case 'rally': {
      const sign = (json.amount ?? 0) > 0 ? '+' : ''
      const t = `${getLocationName(json.gb!)} 士气 ${sign}${json.amount ?? 0}${costSuffix}`
      push({ icon: 'check', tone: 'green', title: '整军', text: json.text ? `${json.text} · ${t}` : t })
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
