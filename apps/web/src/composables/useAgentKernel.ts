/**
 * Agent-Kernel 编排器 —— 回合 P2/P3/P4 的路由中枢。
 *
 * 职责：
 * - 玩家点「结束回合」→ endPlayerTurn() 排空残留 → P2 分流调度
 * - P2: classifyFactions() → related(专属AI) / unrelated(世界AI批量)
 * - P3: 并行 LLM 决策 → parse → submit → advance() 串行演出
 * - P4: 世界 AI 读 eventLog → 叙事 → 推进日期
 *
 * 回合运行时会话（TurnProgress）：一次世界回合按阶段推进
 *   drain → tick → ai → execute → battles → settlement → date → committed
 * 任一阶段遇到 needsPlayerDecision 进入 awaiting-player：剩余指令移出公共队列保存在会话中，
 * 不做战斗/叙事/日期；玩家再次 endPlayerTurn() 时从断点继续，不重复收税、不重新请求模型。
 * 非取代类异常（failed）同样保留断点，重试时从断点继续；整轮战果原子提交成功后战斗阶段不重跑，提交前失败整轮重打（恰好一次）。
 * 世界被替换（读档/换局/换势力）时会话作废。收税与日期推进另由 eventLog 判据兜底：
 * 当前日期已有 economicTick 时绝不再收税，已有 dateAdvance 时绝不再推进。
 *
 * 模块级单例（同 useGameScheduler 模式）：PlayerAiPanel 与地图层共享同一个编排器状态。
 */

import { computed, ref, toRaw, watch } from 'vue'
import { useGameStore, type GameEvent } from '@/stores/game'
import { normalizeCommsFrom } from '@/utils/commsEntity'
import { useGameScheduler, type QueuedOrder } from '@/composables/useGameScheduler'
import { classifyFactions } from '@/utils/aiClassify'
import {
  buildFactionContext,
  buildMinorContext,
  validateFactionOrder,
  decideFaction,
  runWorldBatch,
  runWorldSettle,
} from '@/utils/ai'
import type { GameOrder } from '@/utils/gameOrders'
import type { WorldSettleResult } from '@/utils/ai'
import { Owner, OWNER_LABELS, OWNER_DETAILS } from '@/data/owners'
import { useToast } from '@/composables/useToast'
import { buildEconomicTickEvent } from '@/utils/economicTick'
import { createBatchTroopPreflight } from '@/utils/aiOrderContract'
import { isAiDegraded, type AiStatus } from '@/utils/aiStatus'
import type { FactionDecision } from '@/utils/ai/factionAi'
import { isRoutineEvent } from '@/utils/eventDescribe'

import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import { AI_TELEGRAMS_PER_TURN, LLM_MAX_RETRIES,
  WORLD_AI_DEADLINE_MS, WORLD_AI_ATTEMPT_TIMEOUT_MS } from '@/data/gameConfig'
import type { LlmControlOpts } from '@/composables/useLlmClient'
import { AiWaitError, aiFailureReason, throwIfAiAborted, withAiAbort } from '@/utils/aiWait'
import { defaultWorldSettle } from '@/utils/ai/worldAi'
import { nextTurnDate } from '@/utils/turnDate'
import { isPendingTurnSnapshot } from '@/utils/saveValidation'

// ─── 模块级单例 ───
const loading = ref(false)
const phase = ref<'idle' | 'classifying' | 'ai' | 'advancing' | 'settling' | 'awaiting-player'
  | 'done' | 'error'>('idle')
const progress = ref('')
const lastError = ref('')
const { push: pushToast } = useToast()

/** 回合摘要：本轮新增的 GameEvent 数组，弹窗用；null 表示没有待展示的摘要 */
const turnSummary = ref<GameEvent[] | null>(null)
const turnSummaryOwnership = ref<Record<string, Owner>>({})

export interface WorldAiTask {
  id: string
  label: string
  phase: AiStatus['phase']
  factions: Owner[]
  state: 'waiting' | 'requesting' | 'retrying' | AiStatus['status']
  attempt: number
  maxAttempts: number
  retryDelayMs?: number
  reason?: AiStatus['reason']
}
const worldAiTasks = ref<WorldAiTask[]>([])
const aiWaiting = ref(false)
const waitDeadlineAt = ref<number | null>(null)
const waitRemainingMs = ref(0)
const waitStopReason = ref<'timeout' | 'cancelled' | null>(null)
interface TurnSession {
  controller: AbortController
  reloadToken: number
  faction: Owner
  deadlineTimer?: ReturnType<typeof setTimeout>
  clockTimer?: ReturnType<typeof setInterval>
  stopWatch?: () => void
}
let activeTurn: TurnSession | null = null

export type TurnRuntimeState = 'idle' | 'planning' | 'executing' | 'awaiting-player'
  | 'settling' | 'committed' | 'failed'
type TurnStage = 'drain' | 'tick' | 'ai' | 'execute' | 'battles' | 'settlement' | 'date'
/** 跨多次 endPlayerTurn 调用存活的回合断点（运行时态）。 */
interface TurnProgress {
  reloadToken: number
  faction: Owner
  baseDate: string
  /** 世界代次锚点：eventLog[anchorIndex] 必须仍是同一个事件对象，否则视为世界已被替换。 */
  anchor: GameEvent | null
  anchorIndex: number
  turnStartIdx: number
  ownership: Record<string, Owner>
  stage: TurnStage
  /** 尚未执行的指令（含原执行上下文），只在 awaiting-player / failed 时非空 */
  remaining: QueuedOrder[]
  orderCount: number
  battlesStarted: boolean
  newDate?: string
  recovered?: boolean
}
let turnProgress: TurnProgress | null = null
const turnState = ref<TurnRuntimeState>('idle')
/** 有可恢复的暂停回合（玩家定夺后点「结束回合」继续） */
const awaitingPlayer = ref(false)

/** 存档可携带的暂停回合最小快照（纯 JSON）。由父层 save/load 选择性接入。 */
export interface PendingTurnSnapshot {
  version: 1
  faction: Owner
  baseDate: string
  anchorIndex: number
  anchorType: GameEvent['type']
  turnStartIdx: number
  ownership: Record<string, Owner>
  stage: TurnStage
  remaining: QueuedOrder[]
  orderCount: number
  battlesStarted: boolean
  newDate?: string
}

function rawEventAt(index: number): GameEvent | null {
  const e = useGameStore().eventLog[index]
  return e ? toRaw(e) as GameEvent : null
}
function lastIndexOfType(type: GameEvent['type'], from = 0): number {
  const log = useGameStore().eventLog
  for (let i = log.length - 1; i >= from; i--) if (log[i]?.type === type) return i
  return -1
}
/** 当前日期是否已经收过税：最后一次 dateAdvance 之后存在 economicTick。 */
function taxedThisDate(): number {
  const tick = lastIndexOfType('economicTick')
  return tick > lastIndexOfType('dateAdvance') ? tick : -1
}
function anchorProgress(progress: TurnProgress): void {
  const store = useGameStore()
  progress.anchorIndex = store.eventLog.length - 1
  progress.anchor = rawEventAt(progress.anchorIndex)
}
function progressValid(progress: TurnProgress | null): progress is TurnProgress {
  const store = useGameStore()
  if (!progress) return false
  if (progress.faction !== store.currentFaction || progress.baseDate !== store.currentDate) return false
  // 世界代次：锚点事件对象身份（读档/initWorld 都会替换 eventLog 中的对象）；无锚点时退回 reloadToken
  if (progress.anchorIndex >= 0) {
    if (rawEventAt(progress.anchorIndex) !== progress.anchor) return false
  } else if (progress.reloadToken !== store.reloadToken || store.eventLog.length !== 0) return false
  // 断点之后已出现日期推进 → 该回合已提交，断点无意义
  return lastIndexOfType('dateAdvance', progress.anchorIndex + 1) < 0
}
function setProgress(progress: TurnProgress | null): void {
  turnProgress = progress
  awaitingPlayer.value = !!progress && turnState.value === 'awaiting-player'
}
/** 丢弃暂停/失败断点（读档、开新局时由上层调用；endPlayerTurn 也会自动校验并丢弃过期断点）。 */
function discardPendingTurn(): void {
  if (loading.value) return
  turnProgress = null
  awaitingPlayer.value = false
  if (turnState.value === 'awaiting-player' || turnState.value === 'failed') turnState.value = 'idle'
}
/** 导出暂停回合快照（无暂停时返回 null）；供存档附带。 */
function exportPendingTurn(): PendingTurnSnapshot | null {
  if (loading.value || !progressValid(turnProgress)) return null
  const p = turnProgress
  const anchor = rawEventAt(p.anchorIndex)
  if (!anchor) return null
  return JSON.parse(JSON.stringify({ version: 1, faction: p.faction, baseDate: p.baseDate,
    anchorIndex: p.anchorIndex, anchorType: anchor.type, turnStartIdx: p.turnStartIdx,
    ownership: p.ownership, stage: p.stage, remaining: p.remaining, orderCount: p.orderCount,
    battlesStarted: p.battlesStarted, newDate: p.newDate })) as PendingTurnSnapshot
}
const TURN_STAGES: readonly TurnStage[] = ['drain', 'tick', 'ai', 'execute', 'battles', 'settlement', 'date']
const OWNERS = new Set<string>(Object.values(Owner))
/**
 * 存档是玩家可编辑的输入：只接受 player/faction 权限的普通指令，丢弃 system/debug 权限与
 * setCurrentDate（防止借读档绕过门卫或额外推进日期）；执行时仍经 executeOrder 全量重验。
 */
function sanitizeEntries(value: unknown): QueuedOrder[] | null {
  if (!Array.isArray(value)) return null
  const out: QueuedOrder[] = []
  for (const e of value as unknown[]) {
    const entry = e as { order?: unknown; context?: unknown } | null
    const order = entry?.order as GameOrder | undefined
    const ctx = (entry?.context ?? {}) as QueuedOrder['context']
    if (!order || typeof order !== 'object' || typeof order.order !== 'string') return null
    if (order.order === 'setCurrentDate') return null
    if (ctx.authority !== 'player' && ctx.authority !== 'faction') return null
    if (ctx.actor !== undefined && !OWNERS.has(ctx.actor)) return null
    if (ctx.authority === 'faction' && !ctx.actor) return null
    if (ctx.presentation !== undefined && ctx.presentation !== 'fast' && ctx.presentation !== 'full') return null
    out.push({ order: JSON.parse(JSON.stringify(order)) as GameOrder,
      context: { authority: ctx.authority, actor: ctx.actor, presentation: ctx.presentation } })
  }
  return out
}
/**
 * 读档成功后导入快照；形状非法或与当前世界不一致（版本/势力/日期/锚点事件类型/锚点后已推进日期/
 * 本日期未收税）则整体拒绝并返回 false（此时仍有 eventLog 兜底：不重复收税）。
 */
function importPendingTurn(snapshot: PendingTurnSnapshot | null | undefined): boolean {
  discardPendingTurn()
  const store = useGameStore()
  if (loading.value || !isPendingTurnSnapshot(snapshot)) return false // 纯形状校验（存档层共享）
  const len = store.eventLog.length
  const isIdx = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < len
  if (!isIdx(snapshot.anchorIndex) || !isIdx(snapshot.turnStartIdx)
    || snapshot.turnStartIdx > snapshot.anchorIndex) return false
  if (!TURN_STAGES.includes(snapshot.stage) || snapshot.stage === 'tick' || snapshot.stage === 'ai')
    return false // 暂停只可能发生在 drain/execute；更早阶段没有可恢复的内容
  if (typeof snapshot.orderCount !== 'number' || !Number.isFinite(snapshot.orderCount)) return false
  if (!snapshot.ownership || typeof snapshot.ownership !== 'object') return false
  if (snapshot.newDate !== undefined
    && (typeof snapshot.newDate !== 'string' || nextTurnDate(store.currentDate, snapshot.newDate) !== snapshot.newDate))
    return false
  const remaining = sanitizeEntries(snapshot.remaining)
  if (!remaining) return false
  const anchor = rawEventAt(snapshot.anchorIndex)
  if (!anchor || anchor.type !== snapshot.anchorType || snapshot.faction !== store.currentFaction
    || snapshot.baseDate !== store.currentDate
    || lastIndexOfType('dateAdvance', snapshot.anchorIndex + 1) >= 0) return false
  if (snapshot.stage !== 'drain' && taxedThisDate() < 0) return false
  turnState.value = 'awaiting-player'
  setProgress({ reloadToken: store.reloadToken, faction: snapshot.faction, baseDate: snapshot.baseDate,
    anchor, anchorIndex: snapshot.anchorIndex, turnStartIdx: snapshot.turnStartIdx,
    ownership: { ...snapshot.ownership }, stage: snapshot.stage, remaining,
    orderCount: snapshot.orderCount, battlesStarted: !!snapshot.battlesStarted, newDate: snapshot.newDate })
  phase.value = 'awaiting-player'
  return true
}
const canStopAiWaiting = computed(() => loading.value && aiWaiting.value && !waitStopReason.value)

function ensureCurrent(session: TurnSession): void {
  const store = useGameStore()
  if (activeTurn !== session || store.reloadToken !== session.reloadToken
    || store.currentFaction !== session.faction
    || (session.controller.signal.reason instanceof AiWaitError
      && session.controller.signal.reason.reason === 'superseded'))
    throw new AiWaitError('superseded')
}
function resetWaitProgress(): void {
  if (loading.value) return
  worldAiTasks.value = []
  aiWaiting.value = false
  waitDeadlineAt.value = null
  waitRemainingMs.value = 0
  waitStopReason.value = null
}
function interruptWait(session: TurnSession, reason: 'timeout' | 'cancelled'): void {
  if (session.controller.signal.aborted) return
  waitStopReason.value = reason
  clearTimeout(session.deadlineTimer)
  clearInterval(session.clockTimer)
  waitRemainingMs.value = reason === 'timeout' ? 0
    : Math.max(0, (waitDeadlineAt.value ?? Date.now()) - Date.now())
  session.controller.abort(new AiWaitError(reason))
  if (aiWaiting.value) progress.value = reason === 'timeout'
    ? 'AI 截止时间已到，按已有结果结算…' : '已停止等待，按已有结果结算…'
}
/** Stop only model waiting. Economy, accepted orders, battle formula and date finish once. */
function stopAiWaiting(): boolean {
  if (!canStopAiWaiting.value || !activeTurn) return false
  interruptWait(activeTurn, 'cancelled')
  return true
}
function startWaitDeadline(session: TurnSession): void {
  if (session.deadlineTimer) return // 同一会话内所有模型等待共享一个截止时间
  waitDeadlineAt.value = Date.now() + WORLD_AI_DEADLINE_MS
  waitRemainingMs.value = WORLD_AI_DEADLINE_MS
  session.deadlineTimer = setTimeout(() => interruptWait(session, 'timeout'), WORLD_AI_DEADLINE_MS)
  session.clockTimer = setInterval(() => {
    if (activeTurn === session)
      waitRemainingMs.value = Math.max(0, (waitDeadlineAt.value ?? Date.now()) - Date.now())
  }, 1000)
}
function addTask(id: string, label: string, phase: AiStatus['phase'], factions: Owner[], maxAttempts = LLM_MAX_RETRIES): void {
  worldAiTasks.value = [...worldAiTasks.value, {
    id, label, phase, factions, state: 'waiting', attempt: 0, maxAttempts,
  }]
}
function updateTask(session: TurnSession, id: string, update: Partial<WorldAiTask>): void {
  ensureCurrent(session)
  worldAiTasks.value = worldAiTasks.value.map(task => task.id === id ? { ...task, ...update } : task)
}
function requestControl(session: TurnSession, id: string): LlmControlOpts {
  ensureCurrent(session)
  if (waitDeadlineAt.value && Date.now() >= waitDeadlineAt.value)
    interruptWait(session, 'timeout')
  return { signal: session.controller.signal, attemptTimeoutMs: WORLD_AI_ATTEMPT_TIMEOUT_MS,
    onAttempt: update => {
      if (activeTurn !== session || session.controller.signal.aborted) return
      updateTask(session, id, update)
    } }
}
function finishTask(session: TurnSession, id: string, outcome: Pick<AiStatus, 'status' | 'reason'>): void {
  updateTask(session, id, { state: outcome.status, reason: outcome.reason, retryDelayMs: undefined })
}
async function trackedTask<T>(session: TurnSession, id: string,
  invoke: (control: LlmControlOpts) => Promise<T>,
  outcomeOf: (result: T) => Pick<AiStatus, 'status' | 'reason'>): Promise<T> {
  const row = worldAiTasks.value.find(task => task.id === id)!
  try {
    const result = await withAiAbort(() => {
      const control = requestControl(session, id)
      throwIfAiAborted(control.signal)
      return invoke(control)
    }, session.controller.signal)
    ensureCurrent(session)
    const outcome = outcomeOf(result)
    finishTask(session, id, outcome)
    useGameStore().applyEvent({ type: 'aiStatus', phase: row.phase, factions: row.factions, ...outcome })
    return result
  } catch (error) {
    ensureCurrent(session)
    const outcome = { status: 'failed' as const, reason: aiFailureReason(error) }
    finishTask(session, id, outcome)
    useGameStore().applyEvent({ type: 'aiStatus', phase: row.phase, factions: row.factions, ...outcome })
    throw error
  }
}

/** 调用专属政权 AI，返回通过结构 + 战略校验的 GameOrder[] + 可选电报 + 可选外交提案。 */
async function invokeFactionAI(
  faction: Owner,
  context: string,
  control: LlmControlOpts,
): Promise<FactionDecision> {
  const result = await decideFaction(faction, context, control)
  return result
}

/** 调用世界 AI 批量生成 minor 政权事件 */
async function invokeWorldAIBatch(context: string, control: LlmControlOpts): Promise<FactionDecision> {
  const { orders: rawOrders, errors: rawErrors, parseSucceeded } = await runWorldBatch(context, control)
  throwIfAiAborted(control.signal)

  // 仅解析失败才弹 toast；合法的空 orders（次要势力按兵不动）静默通过
  if (!parseSucceeded) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: '世界 AI 输出格式错误',
      text: 'AI 返回无法解析为 JSON',
    })
    return { orders: [], decisionStatus: { status: 'failed', reason: 'format' } }
  }

  // 反向映射：中文名 → Owner
  const labelToOwner = new Map<string, Owner>()
  for (const [owner, label] of Object.entries(OWNER_LABELS)) {
    labelToOwner.set(label, owner as Owner)
  }

  // 按每条指令的 actor 独立做战略校验
  const store = useGameStore()
  const strategicOk: GameOrder[] = []
  const batch = createBatchTroopPreflight((gb) => store.cities[gb]?.troops)
  for (let i = 0; i < rawOrders.length; i++) {
    // 门卫：结构校验不过的指令（未知指令名 / 非法字段）直接丢弃，不让它漏到执行层
    if (rawErrors[i]?.length) {
      console.warn('[世界AI批量] 结构校验失败，丢弃指令:', rawOrders[i], rawErrors[i])
      continue
    }

    const order = rawOrders[i]
    const rawActor = (order as unknown as Record<string, unknown>).actor as string | undefined
    const actorOwner = rawActor ? labelToOwner.get(rawActor) : undefined
    if (!actorOwner) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'error',
        title: '未知势力',
        text: `${rawActor ?? '?'}：不在势力表中`,
      })
      continue
    }

    const r = validateFactionOrder(
      order,
      actorOwner,
      (gb) => store.ownership[gb],
      batch.troopsFor(actorOwner),
    )
    if (r.ok) {
      strategicOk.push(order)
      batch.accept(order, actorOwner)
    } else if (r.reason) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'error',
        title: `${OWNER_LABELS[actorOwner] ?? actorOwner} 越权`,
        text: r.reason,
      })
    }
  }
  return { orders: strategicOk, decisionStatus: {
    status: rawOrders.length !== strategicOk.length ? 'partial' : rawOrders.length ? 'ok' : 'empty',
    reason: rawOrders.length !== strategicOk.length ? 'filtered' : undefined } }
}

/** 调用世界 AI 做 P4 总结（叙事 + 推进日期 + 世界公屏电报） */
async function invokeWorldAISettle(currentDate: string, control: LlmControlOpts): Promise<WorldSettleResult> {
  return runWorldSettle(currentDate, control)
}

// ─── 公开 API ───

/**
 * P0 经济结算：每回合开局先算各势力收支（本地确定性公式，零 LLM）。
 * 经 applyEvent('economicTick') 落地——明细入 eventLog，replay 重放确定性一致。
 * 欠饷扣士气、缺粮损兵的惩罚由 reducer 内部执行。
 * 玩家相关：若本方欠饷/缺粮则弹 toast 预警。
 */
function runEconomicTick(): void {
  const store = useGameStore()
  const event = buildEconomicTickEvent(store)
  const entries = event.entries
  store.applyEvent(event)

  // 玩家预警
  const pf = store.currentFaction
  if (pf) {
    const me = entries.find((e) => e.faction === pf)
    if (me?.arrear) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'error',
        title: '欠饷',
        text: `银库空虚，全军士气低落（余 ${store.getTreasury(pf)} 万银）`,
      })
    }
    if (me?.famine) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'amber',
        title: '缺粮',
        text: `粮草不继，驻军与外出部队减员（余 ${store.getGranary(pf)} 万石）`,
      })
    }
  }
}

/**
 * 玩家结束回合 → 排空残留指令 → 启动（或从 awaiting-player / failed 断点恢复）世界回合。
 * 返回本次调用后的回合运行时状态。
 */
async function endPlayerTurn(): Promise<TurnRuntimeState> {
  return executeWorldTurn(true)
}

async function runWorldTurn(): Promise<TurnRuntimeState> {
  return executeWorldTurn(false)
}

async function executeWorldTurn(drainPlayer: boolean): Promise<TurnRuntimeState> {
  if (loading.value) return turnState.value
  const store = useGameStore()
  const scheduler = useGameScheduler()

  if (!store.currentFaction) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: '未选势力',
      text: '请先选择势力再结束回合',
    })
    return turnState.value
  }
  if (scheduler.status.value === 'running') {
    pushToast({ icon: 'alert-triangle', tone: 'amber', title: '指令仍在执行',
      text: '请等待当前指令播放完毕后再结束回合' })
    return turnState.value
  }

  resetWaitProgress()
  const session: TurnSession = { controller: new AbortController(),
    reloadToken: store.reloadToken, faction: store.currentFaction }
  activeTurn = session
  session.stopWatch = watch([() => store.reloadToken, () => store.currentFaction], () => {
    session.controller.abort(new AiWaitError('superseded'))
  }, { flush: 'sync' })
  loading.value = true
  turnSummary.value = null
  lastError.value = ''
  phase.value = 'classifying'

  let progress: TurnProgress | null = progressValid(turnProgress) ? turnProgress : null
  if (!progress && turnProgress) turnProgress = null // 过期断点（读档/换局）静默丢弃
  awaitingPlayer.value = false
  try {
    progress ??= recoverFromLog(drainPlayer)
    setProgress(progress)
    turnState.value = progress.stage === 'drain' || progress.stage === 'tick' || progress.stage === 'ai'
      ? 'planning' : 'executing'
    const result = await performWorldTurn(session, progress, drainPlayer)
    turnState.value = result
    setProgress(result === 'awaiting-player' ? progress : null)
  } catch (err) {
    if (err instanceof AiWaitError && err.reason === 'superseded') {
      phase.value = 'idle'
      setProgress(null)
      turnState.value = 'idle'
      // 旧世界的未执行指令不得留在公共队列里被新世界执行
      if (!schedulerBusy() && scheduler.queue.value.length) scheduler.detachQueue()
      worldAiTasks.value = []
      turnSummary.value = null
      turnSummaryOwnership.value = {}
    } else {
      // 保留断点：剩余指令移出公共队列，重试时从断点继续，不重复收税。
      if (turnProgress && !schedulerBusy() && scheduler.queue.value.length)
        turnProgress.remaining = [...scheduler.detachQueue(), ...turnProgress.remaining]
      turnState.value = 'failed'
      lastError.value = (err as Error).message || '未知错误'
      phase.value = 'error'
      pushToast({ icon: 'alert-triangle', tone: 'cinnabar',
        title: '回合推演失败', text: `${lastError.value}；再次结束回合将从断点继续` })
    }
  } finally {
    clearTimeout(session.deadlineTimer)
    clearInterval(session.clockTimer)
    session.stopWatch?.()
    session.controller.abort(new AiWaitError('superseded'))
    activeTurn = null
    aiWaiting.value = false
    loading.value = false
    const finalPhase: string = phase.value
    if (finalPhase !== 'error' && finalPhase !== 'idle' && finalPhase !== 'awaiting-player')
      phase.value = 'done'
    awaitingPlayer.value = turnState.value === 'awaiting-player' && !!turnProgress
  }
  return turnState.value
}

function schedulerBusy(): boolean { return useGameScheduler().status.value === 'running' }

/**
 * 没有可用的运行时断点时，按 eventLog 判断是否存在「已收税未推进日期」的半回合
 * （典型：暂停时存档再读档、旧版本失败后重试）。此时只做结算与日期推进，绝不重复收税或重新决策；
 * 丢失的未执行世界指令无法从日志恢复（见报告的残留限制）。
 */
function recoverFromLog(drainPlayer: boolean): TurnProgress {
  const store = useGameStore()
  const base: TurnProgress = { reloadToken: store.reloadToken, faction: store.currentFaction!,
    baseDate: store.currentDate, anchor: null, anchorIndex: -1, turnStartIdx: store.eventLog.length,
    ownership: { ...store.ownership }, stage: drainPlayer ? 'drain' : 'tick', remaining: [],
    orderCount: 0, battlesStarted: false }
  anchorProgress(base)
  const tick = taxedThisDate()
  if (tick < 0) return base
  // 只认世界回合总结的显式标记；外交收口等其他 settlement 叙事不算（旧存档无标记→重做总结，不跳战斗）
  let settledByWorld = false
  for (let i = store.eventLog.length - 1; i > tick && !settledByWorld; i--) {
    const e = store.eventLog[i]
    settledByWorld = e?.type === 'narrative' && e.scope === 'world-turn'
  }
  base.recovered = true
  base.turnStartIdx = tick
  base.battlesStarted = lastIndexOfType('attack', tick) >= 0
  base.stage = settledByWorld ? 'date' : 'battles'
  pushToast({ icon: 'alert-triangle', tone: 'amber', title: '恢复未完成的回合',
    text: '本日期已结算经济：不重复收税、不重新决策，直接完成战斗裁决与日期推进' })
  return base
}

/**
 * 把条目放回公共队列并串行推进；遇停点把剩余项取回（left）。
 * 'running' 表示调度器被他人占用，不能当作完成。异常时未执行项仍留在公共队列，由外层取回。
 */
async function runQueued(session: TurnSession, entries: QueuedOrder[]):
  Promise<{ result: 'done' | 'stopped'; left: QueuedOrder[] }> {
  const scheduler = useGameScheduler()
  if (entries.length) {
    // 断点剩余项优先于暂停期间玩家新排入的指令
    const pending = scheduler.detachQueue()
    scheduler.restoreQueue(entries)
    scheduler.restoreQueue(pending)
  }
  const result = await scheduler.advance({ guard: () => ensureCurrent(session) })
  ensureCurrent(session)
  if (result === 'running') throw new Error('调度器正被其他操作占用，回合未推进')
  if (result === 'stopped') return { result, left: scheduler.detachQueue() }
  return { result: 'done', left: [] }
}

function pauseForPlayer(turn: TurnProgress): 'awaiting-player' {
  phase.value = 'awaiting-player'
  progressText(`等待主公定夺（剩余 ${turn.remaining.length} 条指令）；结束回合后继续`)
  return 'awaiting-player'
}
function progressText(text: string): void { progress.value = text }

/** P2→P3→P4 世界回合主循环（按阶段，可从断点继续） */
async function performWorldTurn(session: TurnSession, turn: TurnProgress,
  drainPlayer: boolean): Promise<TurnRuntimeState> {
  const store = useGameStore()
  const scheduler = useGameScheduler()
  turnSummaryOwnership.value = { ...turn.ownership }

  // ── 排空玩家残留（含上次暂停时被移出的剩余项）──
  if (turn.stage === 'drain' || (drainPlayer && scheduler.queue.value.length)) {
    phase.value = 'advancing'
    progressText('排空玩家残留指令…')
    const leftovers = turn.stage === 'drain' ? turn.remaining : []
    if (turn.stage === 'drain') turn.remaining = []
    const drained = await runQueued(session, leftovers)
    if (drained.result === 'stopped') {
      // 执行阶段断点中尚未执行的世界指令保留在玩家残留之后
      turn.remaining = [...drained.left, ...turn.remaining]
      anchorProgress(turn) // 锚定到 pauseForPlayer 事件
      return pauseForPlayer(turn)
    }
    if (turn.stage === 'drain') turn.stage = 'tick'
  }

  // ── P0: 经济结算（每个日期恰好一次；eventLog 判据兜底）──
  if (turn.stage === 'tick') {
    turn.turnStartIdx = store.eventLog.length
    turn.ownership = { ...store.ownership }
    turnSummaryOwnership.value = { ...turn.ownership }
    if (taxedThisDate() < 0) runEconomicTick()
    anchorProgress(turn)
    turn.stage = 'ai'
  }

  if (turn.stage === 'ai') {
    turn.remaining = await collectWorldDecisions(session)
    turn.orderCount = turn.remaining.length
    anchorProgress(turn)
    turn.stage = 'execute'
  }

  // ── P3 推进（串行演出；遇停点进入 awaiting-player）──
  if (turn.stage === 'execute') {
    turnState.value = 'executing'
    phase.value = 'advancing'
    progressText(`执行 ${turn.remaining.length} 条指令…`)
    const entries = turn.remaining
    turn.remaining = []
    const executed = await runQueued(session, entries)
    if (executed.result === 'stopped') {
      turn.remaining = executed.left
      anchorProgress(turn)
      return pauseForPlayer(turn)
    }
    turn.stage = 'battles'
  }

  // ── P4a: 战斗裁决（已开始过则不重跑，避免同一日期多打一轮）──
  if (turn.stage === 'battles') {
    turnState.value = 'settling'
    const activeBattles = store.battles.filter((b) => b.active)
    // 日志兜底：本回合起点之后已有战斗回合（attack 只由整轮原子提交产生）即视为已结算
    if (!turn.battlesStarted && lastIndexOfType('attack', Math.max(0, turn.turnStartIdx)) >= 0)
      turn.battlesStarted = true
    if (activeBattles.length > 0 && !turn.battlesStarted) {
      phase.value = 'settling'
      progressText('战斗裁决中…')
      startWaitDeadline(session)
      addTask('battleFlavor', '战斗调味', 'battleFlavor',
        [...new Set(activeBattles.flatMap(b => [b.attacker, b.defender]))], 2)
      let flavorReported = false
      try {
        await scheduler.settleActiveBattles(requestControl(session, 'battleFlavor'), outcome => {
          finishTask(session, 'battleFlavor', outcome)
          flavorReported = true
        }, waiting => { ensureCurrent(session); aiWaiting.value = waiting },
        () => ensureCurrent(session),
        // 整轮战果已原子提交（同步事务成功后、演出前回调）：此后任何失败都不再重打本轮。
        // 推演/调味/提交任一环节失败则世界与日志不留本轮战果，重试会完整重打这一轮（恰好一次）。
        () => { turn.battlesStarted = true })
        ensureCurrent(session)
        // Prechecks may resolve every front locally without needing any model.
        if (!flavorReported) finishTask(session, 'battleFlavor', { status: 'empty' })
      } finally { aiWaiting.value = false }
    }
    turn.stage = 'settlement'
  }

  // ── P4 结算 ──
  if (turn.stage === 'settlement') {
    turnState.value = 'settling'
    phase.value = 'settling'
    progressText('世界 AI 总结中…')
    startWaitDeadline(session)
    const baseDate = turn.baseDate
    addTask('settlement', '世界叙事', 'settlement', [])
    aiWaiting.value = true
    const { narrative, newDate, chatter } = await trackedTask(session, 'settlement',
      control => invokeWorldAISettle(baseDate, control),
      result => result.aiStatus ?? { status: 'ok' }).catch(error => {
        ensureCurrent(session)
        return defaultWorldSettle(baseDate, aiFailureReason(error))
      }).finally(() => { aiWaiting.value = false })
    ensureCurrent(session)
    // 日期由引擎钳制：模型给出的日期不合法时按默认步长推进，绝不原地不动或倒退。
    turn.newDate = nextTurnDate(baseDate, newDate)

    // 系统结算叙事落 eventLog（kind='settlement' 让 aiHistory 不带"玩家："前缀）
    store.applyEvent({ type: 'narrative', playerInput: '', aiMessage: narrative, kind: 'settlement',
      scope: 'world-turn' })
    // 世界公屏电报：from 是 AI 返回的中文势力名，归一化回内部代码
    for (const c of chatter) {
      store.pushTelegram({
        gameDate: turn.newDate,
        from: normalizeCommsFrom(c.from),
        content: c.content,
        channel: 'world',
        turn: store.turnCount,
        leaderName: c.name,
      })
    }
    turn.stage = 'date'
  }

  // ── 推进日期：恰好一次（入调度器走末尾蒙太奇）──
  const newDate = turn.newDate ?? nextTurnDate(turn.baseDate)
  if (lastIndexOfType('dateAdvance', Math.max(0, turn.anchorIndex)) < 0
    && store.currentDate === turn.baseDate) {
    phase.value = 'advancing'
    progressText('推进日期…')
    if (scheduler.queue.value.length) // 不应出现：防止残留指令借日期推进被执行
      turn.remaining = [...turn.remaining, ...scheduler.detachQueue()]
    scheduler.submit([{ order: 'setCurrentDate', date: newDate }], { authority: 'system' })
    const result = await scheduler.advance({ guard: () => ensureCurrent(session) })
    ensureCurrent(session)
    if (result === 'running' || result === 'stopped' || store.currentDate !== newDate)
      throw new Error('日期推进未完成')
  }

  phase.value = 'done'
  progressText('新回合开始')

  // 提取本回合新增事件作为摘要（排除回合开始前的历史事件）
  const newEvents = store.eventLog.slice(turn.turnStartIdx)
  // 只有存在"有意义的事件"（非 routine）时才弹摘要
  const hasMeaningful = newEvents.some((e) => !isRoutineEvent(e))
  turnSummary.value = hasMeaningful ? newEvents : null

  const degraded = turn.recovered
    || newEvents.some((e): e is AiStatus => e.type === 'aiStatus' && isAiDegraded(e))
  pushToast({ icon: degraded ? 'alert-triangle' : 'check', tone: degraded ? 'amber' : 'green',
    title: degraded ? '回合结束（AI 降级）' : '回合结束',
    text: degraded ? `日期推进至 ${newDate}；决策缺失与默认结算详见大事记。不自动重跑已结算行动。` : `日期推进至 ${newDate}` })
  return 'committed'
}

/** P2 分类 + P3 并行模型决策：只收集，不执行。返回带上下文的待执行条目。 */
async function collectWorldDecisions(session: TurnSession): Promise<QueuedOrder[]> {
  const store = useGameStore()
  phase.value = 'classifying'
  progressText('分析势力关系…')

  const snap = store.getSnapshot()
  const presentation = store.fastWorldDomestic ? 'fast' as const : 'full' as const
  const { related, unrelated } = classifyFactions({
    playerFaction: snap.currentFaction,
    activeFactions: snap.activeFactions,
    ownership: snap.ownership,
    eventLog: [...store.eventLog],
    relations: snap.relations,
  })

  progressText(`related: ${related.length}, unrelated: ${unrelated.length}`)

  // ── P3: 并行 AI ──
  phase.value = 'ai'
  progressText('政权 AI 决策中…')
  startWaitDeadline(session)

  const entries: QueuedOrder[] = []
  const factionPromises: {
    faction: Owner
    promise: Promise<FactionDecision>
  }[] = []
  const batchPromises: Promise<FactionDecision>[] = []

  for (const f of related) {
    const ctx = buildFactionContext(f)
    const id = `faction:${f}`
    addTask(id, OWNER_LABELS[f] ?? f, 'faction', [f])
    factionPromises.push({ faction: f, promise: trackedTask(session, id,
      control => invokeFactionAI(f, ctx, control),
      result => result.decisionStatus ?? { status: result.orders.length ? 'ok' : 'empty' }) })
  }

  if (unrelated.length > 0) {
    const ctx = buildMinorContext(unrelated)
    addTask('batch', `世界批量（${unrelated.length} 家）`, 'batch', unrelated)
    batchPromises.push(trackedTask(session, 'batch', control => invokeWorldAIBatch(ctx, control),
      result => result.decisionStatus!))
  }

  // 并行等待：截止/取消后迟到的结果由 withAiAbort 丢弃；世界被替换则整体作废
  aiWaiting.value = true
  const [factionResults, batchResults] = await Promise.all([
    Promise.allSettled(factionPromises.map((p) => p.promise)), Promise.allSettled(batchPromises),
  ]).finally(() => { aiWaiting.value = false })
  ensureCurrent(session)

  let telegramCount = 0
  const MAX_TELEGRAMS_PER_TURN = AI_TELEGRAMS_PER_TURN
  let playerDiplomacyProposed = false
  const diplomacyBus = useDiplomacyBus()

  factionResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const { orders, telegram, diplomaticProposal } = r.value
    const faction = factionPromises[i].faction
    for (const order of orders)
      entries.push({ order, context: { authority: 'faction', actor: faction, presentation } })
    // 电报：软上限每回合 2 封
    if (telegram && telegramCount < MAX_TELEGRAMS_PER_TURN) {
      store.pushTelegram({
        gameDate: snap.currentDate,
        from: faction,
        to: 'PLAYER',
        content: telegram,
        channel: 'direct',
        turn: store.turnCount,
        leaderName: OWNER_DETAILS[faction]?.leader,
      })
      telegramCount++
    }
    // 外交提案（对玩家每回合至多一份）
    if (diplomaticProposal && diplomaticProposal.target) {
      const toPlayer = diplomaticProposal.target === snap.currentFaction
      if (!toPlayer || !playerDiplomacyProposed) {
        diplomacyBus.startAiDiplomacy(
          faction,
          diplomaticProposal.target,
          diplomaticProposal.intent,
          diplomaticProposal.message,
          diplomaticProposal.conditions,
        )
        if (toPlayer) playerDiplomacyProposed = true
      }
    }
  })

  for (const r of batchResults) {
    if (r.status !== 'fulfilled') continue
    for (const order of r.value.orders) {
      const actor = normalizeCommsFrom((order as GameOrder & { actor: string }).actor) as Owner
      entries.push({ order, context: { authority: 'faction', actor, presentation } })
    }
  }
  return entries
}

export function useAgentKernel() {
  useGameStore().setPendingTurnProvider(exportPendingTurn)
  return {
    loading,
    phase,
    progress,
    lastError,
    turnSummary,
    turnSummaryOwnership,
    worldAiTasks,
    aiWaiting,
    waitDeadlineAt,
    waitRemainingMs,
    waitStopReason,
    canStopAiWaiting,
    stopAiWaiting,
    resetWaitProgress,
    endPlayerTurn,
    runWorldTurn,
    turnState,
    awaitingPlayer,
    discardPendingTurn,
    exportPendingTurn,
    importPendingTurn,
  }
}
