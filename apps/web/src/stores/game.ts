import { defineStore } from 'pinia'
import { ref, shallowRef, computed, triggerRef } from 'vue'
import { chinaCities } from '@/data/chinaCities'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { resetBattleRuntime } from '@/utils/gameOrders'
import { useToast } from '@/composables/useToast'

// 战斗元数据（PixiJS 句柄不进 store，由 gameOrders 模块本地持有）
export interface BattleInfo {
  id: string
  from: string
  to: string
  fromName: string
  toName: string
  active: boolean
}

/** 电报（AI 自主生成，非世界态事件，不进 eventLog） */
export interface Telegram {
  id: string
  /** 游戏内日期 */
  gameDate: string
  /** 发报势力（世界公屏可非 Owner，用 'WORLD' 占位） */
  from: string
  /** AI 返回的发报人名称（优先用于显示，不一定是最高领导） */
  leaderName?: string
  /** 正文 */
  content: string
  /** direct = 往来势力私信；world = 天下公屏 */
  channel: 'direct' | 'world'
  /** 回合序号 */
  turn: number
  read: boolean
}

/**
 * 世界态快照 —— 供 AI 读取的「只读、脱离响应式」视图。
 * getSnapshot() 返回的是普通对象拷贝，序列化给 LLM 安全，
 * 且不会在调用方建立任何 Pinia 响应式依赖。
 */
/** 单座城市的完整可变态。seed 仅在 initWorld() 单向灌溉一次，之后只经 applyEvent 改写。 */
export interface CityState {
  gb: string
  name: string
  owner: Owner
  terrain?: string
  cityLevel: number
  industry: number
  food: number
  fort: number
  troops: number // 驻军，单位：千（k）
  morale: number // 城市士气 0-100
}

/**
 * 世界态事件（Kernel 的 reducer 输入）。
 * 所有世界态变更（城市态 owner/troops/morale、日期推进、势力存亡）
 * 都必须封装成 GameEvent，经 applyEvent 落地——这是唯一写者（initWorld 播种除外）。
 */
export type GameEvent =
  | { type: 'capture'; targetGb: string; actor: Owner; resultTroops?: number }
  | { type: 'moveTroops'; fromGb: string; toGb: string; amount: number }
  | { type: 'attack'; fromGb: string; targetGb: string; attackerLoss: number; defenderLoss: number }
  | { type: 'moraleChange'; targetGb: string; delta: number }
  | { type: 'produce'; targetGb: string; amount: number }
  | { type: 'dateAdvance'; date: string }
  | { type: 'setFactionAlive'; faction: Owner; alive: boolean }
  | { type: 'battleStart'; battleId: string; fromGb: string; targetGb: string; fromName: string; toName: string }
  | { type: 'battleEnd'; battleId: string }
  | { type: 'selectFaction'; faction: Owner; playerName: string }
  | { type: 'narrative'; playerInput: string; aiMessage: string; kind?: 'player' | 'settlement' }

// ── 存档 / 持久化 ──

const SAVE_PREFIX = 'mapwar_save_'
const AUTO_SLOT = 'auto'
const META_KEY = `${SAVE_PREFIX}meta`

/** localStorage 持久化的存档结构 */
interface SaveData {
  version: number
  label: string
  savedAt: number
  playerName: string
  currentFaction: Owner | null
  eventLog: GameEvent[]
  /** 电报历史（v1 新增，老存档兼容缺省 []） */
  telegrams?: Telegram[]
  /** 回合计数（v1 新增，老存档兼容缺省 0） */
  turnCount?: number
}

/** 存档摘要（供选择界面用，不入存档文件） */
export interface SaveMeta {
  slot: string
  label: string
  savedAt: number
  playerName: string
  currentDate: string
  eventCount: number
}

export interface WorldStateSnapshot {
  /** 当前推演日期 */
  currentDate: string
  /** 玩家所选势力（未选为 null） */
  currentFaction: Owner | null
  /** 当前存活的势力列表 */
  activeFactions: Owner[]
  /** 城市归属表：gb 编码 -> 控制政权（派生自 cities） */
  ownership: Record<string, Owner>
  /** 每城动态态，供 AI 据局势决策 */
  cities: Record<string, { owner: Owner; troops: number; morale: number }>
  /** 势力派生聚合（不存）：总兵力，单位 k */
  factionTroops: Record<string, number>
  /** 势力派生聚合（不存）：按兵力加权的平均士气 */
  factionMorale: Record<string, number>
  /** 进行中的战斗元数据列表 */
  battles: BattleInfo[]
}

export const useGameStore = defineStore('game', () => {
  // ── 城市态：唯一真相源 ──
  // seed 仅在 initWorld() 单向灌溉一次；之后任何城市态变更只经 applyEvent（Kernel 唯一写者）。
  const cities = shallowRef<Record<string, CityState>>({})

  // ── 事件日志（存档 / replay 的核心数据）──
  const eventLog = ref<GameEvent[]>([])
  const isReplaying = ref(false) // replay 期间抑制日志重复追加 + 自动存档 + watcher 重绘
  // 读档后请求地图重绘的信号：load() 只重建 store 状态，地图重绘/动画重建/复位 isReplaying
  // 这段"收尾"能力在 LeafletMap（loadLayer/restoreActiveAnimations）里。store 不反向依赖组件，
  // 改用计数器信号：requestMapReload() ++token → LeafletMap watch(token) 收尾。
  const reloadToken = ref(0)

  // 派生投影：owner 视图（保持旧接口，读自 cities）
  const ownership = computed<Record<string, Owner>>(() =>
    Object.fromEntries(Object.entries(cities.value).map(([gb, c]) => [gb, c.owner])),
  )
  const currentDate = ref('1931-01-01')
  const currentFaction = ref<Owner | null>(null)
  const playerName = ref('')
  const activeFactions = ref<Owner[]>([
    Owner.KMT,
    Owner.CCP,
    Owner.JPN,
    Owner.NEA,
    Owner.SHX,
    Owner.GXC,
    Owner.SCC,
    Owner.MA,
    Owner.XJ,
    Owner.TIB,
  ])
  const battles = ref<BattleInfo[]>([])

  // ── 电报（AI 自主生成，不进 eventLog，单独持久化）──
  const telegrams = ref<Telegram[]>([])
  const turnCount = ref(0) // 当前回合序号（dateAdvance 时 +1）
  let _tgSeq = 0 // 模块内自增 id，无需持久化（id 已含时间戳）

  // ── 派生（不存）──
  const myCities = computed(() =>
    Object.entries(ownership.value)
      .filter(([, o]) => o === currentFaction.value)
      .map(([gb]) => gb),
  )
  const cityOwner = (gb: string): Owner | undefined => ownership.value[gb]
  const isAlive = (f: Owner): boolean => activeFactions.value.includes(f)
  const factionCities = (f: Owner): string[] =>
    Object.entries(ownership.value)
      .filter(([, o]) => o === f)
      .map(([gb]) => gb)

  // 势力级数字 = 所辖城市态的派生聚合（不存，永远是算出来的）
  function factionTroops(o: Owner): number {
    return Object.values(cities.value)
      .filter((c) => c.owner === o)
      .reduce((s, c) => s + c.troops, 0)
  }
  function factionMorale(o: Owner): number {
    const owned = Object.values(cities.value).filter((c) => c.owner === o)
    const total = owned.reduce((s, c) => s + c.troops, 0)
    if (!total) return 0
    return Math.round(owned.reduce((s, c) => s + c.morale * c.troops, 0) / total)
  }

  // ── 聚焦请求（面板 → 地图联动）──
  const focusTarget = ref<{ type: 'city' | 'battle'; id: string } | null>(null)
  function requestFocus(type: 'city' | 'battle', id: string): void {
    focusTarget.value = { type, id }
  }

  // ── 我方聚合（派生，不存）──
  type MyCityStat = Pick<CityState, 'gb' | 'name' | 'cityLevel' | 'industry' | 'food' | 'fort'>
  interface MyStats {
    cityCount: number
    totalIndustry: number
    totalFood: number
    avgFort: number
    levelDistribution: Record<number, number>
    cities: MyCityStat[]
  }
  const myStats = computed<MyStats>(() => {
    const f = currentFaction.value
    const stats: MyCityStat[] = []
    if (f) {
      for (const c of Object.values(cities.value)) {
        if (c.owner !== f) continue
        stats.push({
          gb: c.gb,
          name: c.name,
          cityLevel: c.cityLevel,
          industry: c.industry,
          food: c.food,
          fort: c.fort,
        })
      }
      stats.sort((a, b) => b.cityLevel - a.cityLevel || a.name.localeCompare(b.name))
    }
    const totalIndustry = stats.reduce((s, c) => s + c.industry, 0)
    const totalFood = stats.reduce((s, c) => s + c.food, 0)
    const avgFort = stats.length
      ? Math.round((stats.reduce((s, c) => s + c.fort, 0) / stats.length) * 10) / 10
      : 0
    const levelDistribution: Record<number, number> = {}
    for (const c of stats) {
      levelDistribution[c.cityLevel] = (levelDistribution[c.cityLevel] ?? 0) + 1
    }
    return { cityCount: stats.length, totalIndustry, totalFood, avgFort, levelDistribution, cities: stats }
  })

  const myBattles = computed(() => {
    const f = currentFaction.value
    if (!f) return []
    return battles.value.filter((b) => {
      const oFrom = b.from ? ownership.value[b.from] : undefined
      const oTo = b.to ? ownership.value[b.to] : undefined
      return oFrom === f || oTo === f
    })
  })

  // ── 初始化 / 设置 ──
  // seed 单向灌溉：仅在此处读取 chinaCities，之后世界态完全活在 cities 里。
  function initWorld(): void {
    activeFactions.value = [
      Owner.KMT, Owner.CCP, Owner.JPN, Owner.NEA,
      Owner.SHX, Owner.GXC, Owner.SCC, Owner.MA, Owner.XJ, Owner.TIB,
    ]
    const seed: Record<string, CityState> = {}
    for (const c of chinaCities) {
      if (!c.gb) continue
      seed[c.gb] = {
        gb: c.gb,
        name: c.name,
        owner: (c.owner as Owner) ?? Owner.NEUTRAL,
        terrain: c.terrain,
        cityLevel: c.cityLevel ?? 0,
        industry: c.industry ?? 0,
        food: c.food ?? 0,
        fort: c.fort ?? 0,
        troops: c.troops ?? 0,
        morale: c.morale ?? 70,
      }
    }
    cities.value = seed // 一次替换，一次触发
    currentDate.value = '1931-04-01'
    playerName.value = ''
    currentFaction.value = null
    eventLog.value = [] // 重置事件日志
    battles.value = []   // 重置战斗列表（否则重复读档会叠加）
    telegrams.value = [] // 重置电报
    turnCount.value = 0
  }

  function selectFaction(f: Owner): void {
    applyEvent({ type: 'selectFaction', faction: f, playerName: playerName.value })
    // 择势提示（开局 / god-mode 两条路径都经此；读档重放不触发）
    if (!isReplaying.value) {
      const label = (OWNER_LABELS as Record<string, string>)[f] ?? f
      useToast().push({ icon: 'crown', tone: 'cinnabar', title: '择势', text: `主公择 ${label}` })
    }
  }

  function setPlayer(name: string, faction: Owner): void {
    applyEvent({ type: 'selectFaction', faction, playerName: name })
  }

  /**
   * 读取世界态快照（非响应式副本）。
   * 用途：把当前局势一次性交给 AI 当只读上下文。
   * 所有字段均为拷贝，调用方对返回值的修改不会影响 store 本身。
   */
  function getSnapshot(): WorldStateSnapshot {
    const factionTroopsMap: Record<string, number> = {}
    const factionMoraleMap: Record<string, number> = {}
    for (const f of activeFactions.value) {
      factionTroopsMap[f] = factionTroops(f)
      factionMoraleMap[f] = factionMorale(f)
    }
    return {
      currentDate: currentDate.value,
      currentFaction: currentFaction.value,
      activeFactions: [...activeFactions.value],
      ownership: { ...ownership.value },
      cities: Object.fromEntries(
        Object.entries(cities.value).map(([gb, c]) => [gb, { owner: c.owner, troops: c.troops, morale: c.morale }]),
      ),
      factionTroops: factionTroopsMap,
      factionMorale: factionMoraleMap,
      battles: battles.value.map((b) => ({ ...b })),
    }
  }

  /**
   * Kernel = 唯一写者。任何世界态变更（城市态 / 日期 / 势力存亡）都必须走这里，
   * 确定性地 apply 事件。外部（gameOrders / AI）不得直接改世界态，只能 submit 事件。
   * 例外：initWorld() 开局播种可直接写（仅此一处）。
   */
  function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
  }

  /**
   * 前置校验：检测事件所需的 world 资源是否齐全（城市态事件 / moveTroops）。
   * 在 applyEvent 入口处统一拦截，避免静默 return。
   * 返回 {ok:true} 或 {ok:false, reason:string}。
   */
  function preCheck(e: GameEvent): { ok: true } | { ok: false; reason: string } {
    switch (e.type) {
      case 'moveTroops': {
        const from = cities.value[e.fromGb]
        const to = cities.value[e.toGb]
        if (!from) return { ok: false, reason: `调兵源城不存在: ${e.fromGb}` }
        if (!to) return { ok: false, reason: `调兵目标城不存在: ${e.toGb}` }
        if (e.amount <= 0) return { ok: false, reason: `调兵量必须为正: ${e.amount}` }
        return { ok: true }
      }
      case 'capture':
      case 'moraleChange':
      case 'produce': {
        if (!cities.value[e.targetGb]) {
          return { ok: false, reason: `城市不存在: ${e.targetGb}` }
        }
        return { ok: true }
      }
      case 'attack': {
        if (!cities.value[e.targetGb]) {
          return { ok: false, reason: `目标城不存在: ${e.targetGb}` }
        }
        if (e.fromGb && !cities.value[e.fromGb]) {
          return { ok: false, reason: `源城不存在: ${e.fromGb}` }
        }
        return { ok: true }
      }
      // 以下事件不依赖城市态，无需前置校验
      case 'dateAdvance':
      case 'setFactionAlive':
      case 'battleStart':
      case 'battleEnd':
      case 'selectFaction':
      case 'narrative':
        return { ok: true }
    }
  }

  /**
   * Kernel = 唯一写者。任何世界态变更（城市态 / 日期 / 势力存亡）都必须走这里。
   *
   * 返回 {ok, reason?} 让调用方能区分"成功"与"apply 拒绝"，便于 toast 反馈。
   * 失败也 push eventLog（保持 replay 严格等价：replay 时同一事件再次拒绝，世界态再次未变）。
   *
   * 外部（gameOrders / AI）不得直接改世界态，只能 submit 事件。
   * 例外：initWorld() 开局播种可直接写（仅此一处）。
   */
  function applyEvent(e: GameEvent): { ok: boolean; reason?: string } {
    // 1. 前置校验（拦截 4 个静默 return 点；先校验再 push 让坏事件也能进日志但不影响世界态）
    const check = preCheck(e)
    if (!check.ok) {
      // 仍 push 到日志（replay 严格等价）；世界态未变
      if (!isReplaying.value) eventLog.value.push(e)
      return { ok: false, reason: check.reason }
    }

    // 2. push 日志（replay 期间由 load 直接覆盖，不重复追加）
    if (!isReplaying.value) eventLog.value.push(e)

    // 3. 非城市态事件：无 targetGb，提前处理并 return
    if (e.type === 'dateAdvance') {
      currentDate.value = e.date
      turnCount.value++
      if (!isReplaying.value) autoSave()
      return { ok: true }
    }
    if (e.type === 'setFactionAlive') {
      const has = activeFactions.value.includes(e.faction)
      if (e.alive && !has) activeFactions.value = [...activeFactions.value, e.faction]
      if (!e.alive && has) activeFactions.value = activeFactions.value.filter((x) => x !== e.faction)
      return { ok: true }
    }
    // 战斗生命周期事件（无 targetGb，管理 battles 数组）
    if (e.type === 'battleStart') {
      battles.value.push({ id: e.battleId, from: e.fromGb, to: e.targetGb, fromName: e.fromName, toName: e.toName, active: true })
      return { ok: true }
    }
    if (e.type === 'battleEnd') {
      battles.value = battles.value.filter((b) => b.id !== e.battleId)
      return { ok: true }
    }
    // 玩家择势事件
    if (e.type === 'selectFaction') {
      playerName.value = e.playerName
      currentFaction.value = e.faction
      return { ok: true }
    }
    // 叙事事件：玩家输入 + AI 总结，仅记录不改变世界态
    if (e.type === 'narrative') return { ok: true }
    // 调兵：己方两城间搬运驻军（from 扣、to 加，钳制 ≥0）
    // 必须用 fromGb/toGb，不能走下面的 targetGb 分支（本事件无 targetGb，会提前 return 丢失）
    if (e.type === 'moveTroops') {
      // preCheck 已保证 from/to 存在
      const from = cities.value[e.fromGb]!
      const to = cities.value[e.toGb]!
      from.troops = Math.max(0, from.troops - e.amount)
      to.troops += e.amount
      triggerRef(cities) // shallowRef 手动通知：城市态已变更
      return { ok: true }
    }
    // 以下均为城市态事件；preCheck 已保证 targetGb 存在
    const t = cities.value[e.targetGb]!
    switch (e.type) {
      case 'capture': // 占领：易主 + 设定新驻军
        t.owner = e.actor
        if (e.resultTroops != null) t.troops = Math.max(0, e.resultTroops)
        break
      case 'attack': { // 进攻未占：双方按裁定损耗扣兵（fromGb 为调兵源城）
        // preCheck 已保证 fromGb 存在（如果提供了）
        if (e.fromGb) {
          const from = cities.value[e.fromGb]!
          from.troops = Math.max(0, from.troops - e.attackerLoss)
        }
        t.troops = Math.max(0, t.troops - e.defenderLoss)
        break
      }
      case 'moraleChange': // 士气增减（胜升/败降/被孤立）
        t.morale = clamp(t.morale + e.delta, 0, 100)
        break
      case 'produce': // 生产/征兵
        t.troops += e.amount
        break
    }
    triggerRef(cities) // shallowRef 手动通知：城市态已变更
    return { ok: true }
  }

  // ── 存档 / 读档（事件日志持久化到 localStorage）──

  /** 读取所有存档槽位的摘要（供选择 UI 用） */
  function _readAllMeta(): Record<string, SaveMeta> {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || '{}')
    } catch {
      return {}
    }
  }

  function _updateMeta(slot: string, meta: SaveMeta): void {
    const all = _readAllMeta()
    all[slot] = meta
    localStorage.setItem(META_KEY, JSON.stringify(all))
  }

  /** 存档：当前事件日志 + 玩家身份序列化到指定槽位。返回是否成功。 */
  function save(slot: string, opts?: { label?: string }): boolean {
    const label = opts?.label || `存档 ${currentDate.value}`
    const data: SaveData = {
      version: 1,
      label,
      savedAt: Date.now(),
      playerName: playerName.value,
      currentFaction: currentFaction.value,
      eventLog: eventLog.value,
      telegrams: telegrams.value,
      turnCount: turnCount.value,
    }
    try {
      localStorage.setItem(`${SAVE_PREFIX}${slot}`, JSON.stringify(data))
      _updateMeta(slot, {
        slot,
        label,
        savedAt: data.savedAt,
        playerName: playerName.value,
        currentDate: currentDate.value,
        eventCount: eventLog.value.length,
      })
      return true
    } catch {
      return false
    }
  }

  /** 读档：initWorld 重置基线 → 逐事件重放 → 恢复玩家身份。返回是否成功。 */
  function load(slot: string): boolean {
    const raw = localStorage.getItem(`${SAVE_PREFIX}${slot}`)
    if (!raw) return false
    try {
      const data: SaveData = JSON.parse(raw)
      if (data.version !== 1) return false

      isReplaying.value = true
      initWorld()
      resetBattleRuntime()
      for (const e of data.eventLog) {
        const r = applyEvent(e)
        // 老存档可能含坏事件（结构合法但 world 资源缺失，如城市被删除）；
        // 不 throw（避免单条坏事件挂掉整次读档），仅 warn 保留可观测性
        if (!r.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[load] 事件 ${e.type} apply 失败: ${r.reason ?? '未知原因'}`)
        }
      }
      eventLog.value = data.eventLog
      telegrams.value = data.telegrams ?? []
      turnCount.value = data.turnCount ?? 0

      return true
    } catch {
      isReplaying.value = false
      return false
    }
  }

  /**
   * 单步撤销帧：克隆当前可变异世界态，供调试工具「执行前打快照、出错/后悔时回滚」。
   * 仅克隆调试需要回退的字段，不碰事件日志以外的派生投影（它们会随重赋值自动重算）。
   */
  interface UndoFrame {
    cities: Record<string, CityState>
    currentDate: string
    currentFaction: Owner | null
    activeFactions: Owner[]
    battles: BattleInfo[]
    eventLog: GameEvent[]
  }

  function snapshotForUndo(): UndoFrame {
    // 注意：battles / eventLog 是 ref（深层响应式 Proxy），structuredClone 无法克隆 Vue Proxy，
    // 故改用 .map 展开为独立纯对象拷贝。BattleInfo / GameEvent 均为扁平结构，浅拷贝即等价于深拷贝。
    // cities 是 shallowRef（.value 为普通对象），可直接 structuredClone。
    return {
      cities: structuredClone(cities.value),
      currentDate: currentDate.value,
      currentFaction: currentFaction.value,
      activeFactions: [...activeFactions.value],
      battles: battles.value.map((b) => ({ ...b })),
      eventLog: eventLog.value.map((e) => ({ ...e })),
    }
  }

  function restoreUndo(frame: UndoFrame): void {
    cities.value = structuredClone(frame.cities)
    currentDate.value = frame.currentDate
    currentFaction.value = frame.currentFaction
    activeFactions.value = [...frame.activeFactions]
    battles.value = structuredClone(frame.battles)
    eventLog.value = structuredClone(frame.eventLog)
    reloadToken.value++ // 触发地图重绘（与读档收尾同一信号）
  }

  /**
   * 请求地图重绘收尾（读档后调用）。
   * load() 只重建 store 状态并保持 isReplaying=true；真正的地图重绘 + 战斗动画重建 + 复位
   * isReplaying 由 LeafletMap 的 watch(reloadToken) 完成（那里才有 loadLayer/restoreActiveAnimations）。
   */
  function requestMapReload(): void {
    reloadToken.value++
  }

  /** 删除指定槽位的存档 */
  function deleteSave(slot: string): void {
    localStorage.removeItem(`${SAVE_PREFIX}${slot}`)
    const all = _readAllMeta()
    delete all[slot]
    localStorage.setItem(META_KEY, JSON.stringify(all))
  }

  /** 列出所有存档摘要（slot → meta） */
  function listSaves(): Record<string, SaveMeta> {
    return _readAllMeta()
  }

  /** 自动存档（写入 "auto" 槽，每次 dateAdvance 后触发） */
  function autoSave(): void {
    save(AUTO_SLOT, { label: `自动存档 ${currentDate.value}` })
  }

  // ── 电报（不进 eventLog，非世界态）──

  function pushTelegram(t: Omit<Telegram, 'id' | 'read'>): void {
    telegrams.value.push({
      ...t,
      id: `tg_${Date.now()}_${_tgSeq++}`,
      read: false,
    })
  }

  /** 标记某频道（势力 from 或 'world'）所有电报已读 */
  function markChannelRead(from: string): void {
    for (const t of telegrams.value) {
      if (t.from === from && !t.read) t.read = true
    }
  }

  /** 未读电报总数（供按钮角标） */
  const unreadCount = computed(() => telegrams.value.filter((t) => !t.read).length)

  /** 未读电报按频道分组（供面板列表角标） */
  const unreadByChannel = computed(() => {
    const m: Record<string, number> = {}
    for (const t of telegrams.value) {
      if (!t.read) m[t.from] = (m[t.from] ?? 0) + 1
    }
    return m
  })

  return {
    cities,
    ownership,
    currentDate,
    currentFaction,
    playerName,
    activeFactions,
    battles,
    eventLog,
    isReplaying,
    reloadToken,
    myCities,
    cityOwner,
    isAlive,
    factionCities,
    factionTroops,
    factionMorale,
    focusTarget,
    requestFocus,
    myStats,
    myBattles,
    initWorld,
    selectFaction,
    setPlayer,
    applyEvent,
    getSnapshot,
    snapshotForUndo,
    restoreUndo,
    save,
    load,
    deleteSave,
    listSaves,
    requestMapReload,
    // 电报
    telegrams,
    turnCount,
    pushTelegram,
    markChannelRead,
    unreadCount,
    unreadByChannel,
  }
})
