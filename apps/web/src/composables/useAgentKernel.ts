/**
 * Agent-Kernel 编排器 —— 回合 P2/P3/P4 的路由中枢。
 *
 * 职责：
 * - 玩家点「结束回合」→ endPlayerTurn() 排空残留 → P2 分流调度
 * - P2: classifyFactions() → related(专属AI) / unrelated(世界AI批量)
 * - P3: 并行 LLM 决策 → parse → submit → advance() 串行演出
 * - P4: 世界 AI 读 eventLog → 叙事 → 推进日期
 *
 * 模块级单例（同 useGameScheduler 模式）：PlayerAiPanel 与地图层共享同一个编排器状态。
 */

import { computed, ref, watch } from 'vue'
import { useGameStore, type GameEvent } from '@/stores/game'
import { normalizeCommsFrom } from '@/utils/commsEntity'
import { useGameScheduler } from '@/composables/useGameScheduler'
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

// ─── 模块级单例 ───
const loading = ref(false)
const phase = ref<'idle' | 'classifying' | 'ai' | 'advancing' | 'settling' | 'done' | 'error'>(
  'idle',
)
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

/** 玩家结束回合 → 排空残留指令 → 启动世界回合 */
async function endPlayerTurn(): Promise<void> {
  return executeWorldTurn(true)
}

async function runWorldTurn(): Promise<void> {
  return executeWorldTurn(false)
}

async function executeWorldTurn(drainPlayer: boolean): Promise<void> {
  if (loading.value) return
  const store = useGameStore()
  const scheduler = useGameScheduler()

  if (!store.currentFaction) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: '未选势力',
      text: '请先选择势力再结束回合',
    })
    return
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

  try {
    // 排空玩家残留指令
    if (drainPlayer) {
      phase.value = 'advancing'
      progress.value = '排空玩家残留指令…'
      await scheduler.advance()
      ensureCurrent(session)
    }

    // 启动世界回合
    await performWorldTurn(session)
  } catch (err) {
    if (err instanceof AiWaitError && err.reason === 'superseded') {
      phase.value = 'idle'
      progress.value = ''
      worldAiTasks.value = []
      turnSummary.value = null
      turnSummaryOwnership.value = {}
    } else {
      lastError.value = (err as Error).message || '未知错误'
      phase.value = 'error'
      pushToast({ icon: 'alert-triangle', tone: 'cinnabar',
        title: '回合推演失败', text: lastError.value })
    }
  } finally {
    clearTimeout(session.deadlineTimer)
    clearInterval(session.clockTimer)
    session.stopWatch?.()
    session.controller.abort(new AiWaitError('superseded'))
    activeTurn = null
    aiWaiting.value = false
    loading.value = false
    if (phase.value !== 'error' && phase.value !== 'idle') phase.value = 'done'
  }
}

/** P2→P3→P4 世界回合主循环 */
async function performWorldTurn(session: TurnSession): Promise<void> {
  const store = useGameStore()
  const scheduler = useGameScheduler()

  // 记录本回合开始前的事件日志长度，结束后取增量作为回合摘要
  const turnStartIdx = store.eventLog.length

  // ── P0: 经济结算（每回合开局先收税扣养兵，AI 据新国库决策）──
  runEconomicTick()

  // ── P2: 分类 ──
  phase.value = 'classifying'
  progress.value = '分析势力关系…'

  const snap = store.getSnapshot()
  turnSummaryOwnership.value = { ...snap.ownership }
  const presentation = store.fastWorldDomestic ? 'fast' as const : 'full' as const
  const { related, unrelated } = classifyFactions({
    playerFaction: snap.currentFaction,
    activeFactions: snap.activeFactions,
    ownership: snap.ownership,
    eventLog: [...store.eventLog],
    relations: snap.relations,
  })

  progress.value = `related: ${related.length}, unrelated: ${unrelated.length}`

  // ── P3: 并行 AI ──
  phase.value = 'ai'
  progress.value = '政权 AI 决策中…'
  startWaitDeadline(session)

  const allOrders: GameOrder[] = []

  // 并行：related 各自独立 + unrelated 批量一次
  // invokeFactionAI 返回 { orders, telegram }；invokeWorldAIBatch 返回 GameOrder[]
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

  // 并行等待
  aiWaiting.value = true
  const [factionResults, batchResults] = await Promise.all([
    Promise.allSettled(factionPromises.map((p) => p.promise)), Promise.allSettled(batchPromises),
  ]).finally(() => { aiWaiting.value = false })
  ensureCurrent(session)

  // 收集 related 势力的指令 + 电报 + 外交提案
  let telegramCount = 0
  const MAX_TELEGRAMS_PER_TURN = AI_TELEGRAMS_PER_TURN
  let playerDiplomacyProposed = false
  const diplomacyBus = useDiplomacyBus()

  factionResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const { orders, telegram, diplomaticProposal } = r.value
    const faction = factionPromises[i].faction
    if (orders.length) {
      allOrders.push(...orders)
      scheduler.submit(orders, { authority: 'faction', actor: faction, presentation })
    }
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
    // 外交提案
    if (diplomaticProposal && diplomaticProposal.target) {
      if (diplomaticProposal.target === snap.currentFaction) {
        if (!playerDiplomacyProposed) {
          diplomacyBus.startAiDiplomacy(
            faction,
            diplomaticProposal.target,
            diplomaticProposal.intent,
            diplomaticProposal.message,
            diplomaticProposal.conditions,
          )
          playerDiplomacyProposed = true
        }
      } else {
        diplomacyBus.startAiDiplomacy(
          faction,
          diplomaticProposal.target,
          diplomaticProposal.intent,
          diplomaticProposal.message,
          diplomaticProposal.conditions,
        )
      }
    }
  })

  // 收集 unrelated 批量指令
  for (const r of batchResults) {
    if (r.status === 'fulfilled' && r.value.orders.length) {
      allOrders.push(...r.value.orders)
      for (const order of r.value.orders) {
        const actor = normalizeCommsFrom((order as GameOrder & { actor: string }).actor) as Owner
        scheduler.submit([order], { authority: 'faction', actor, presentation })
      }
    }
  }

  // ── P3 推进（串行演出）──
  phase.value = 'advancing'
  progress.value = `执行 ${allOrders.length} 条指令…`
  await scheduler.advance()
  ensureCurrent(session)

  // ── P4a: 战斗裁决 ──
  const activeBattles = store.battles.filter((b) => b.active)
  if (activeBattles.length > 0) {
    phase.value = 'settling'
    progress.value = '战斗裁决中…'
    addTask('battleFlavor', '战斗调味', 'battleFlavor',
      [...new Set(activeBattles.flatMap(b => [b.attacker, b.defender]))], 2)
    let flavorReported = false
    try {
      await scheduler.settleActiveBattles(requestControl(session, 'battleFlavor'), outcome => {
        finishTask(session, 'battleFlavor', outcome)
        flavorReported = true
      }, waiting => { ensureCurrent(session); aiWaiting.value = waiting })
      ensureCurrent(session)
      // Prechecks may resolve every front locally without needing any model.
      if (!flavorReported) finishTask(session, 'battleFlavor', { status: 'empty' })
    } finally { aiWaiting.value = false }
  }

  // ── P4 结算 ──
  phase.value = 'settling'
  progress.value = '世界 AI 总结中…'

  // P4 user 消息由 buildSettleContext 内部生成（#5.3：buildSettleContext 自取 sinceDateAdvance 历史）
  addTask('settlement', '世界叙事', 'settlement', [])
  aiWaiting.value = true
  const { narrative, newDate, chatter } = await trackedTask(session, 'settlement',
    control => invokeWorldAISettle(snap.currentDate, control),
    result => result.aiStatus ?? { status: 'ok' }).catch(error => {
      ensureCurrent(session)
      return defaultWorldSettle(snap.currentDate, aiFailureReason(error))
    }).finally(() => { aiWaiting.value = false })
  ensureCurrent(session)

  // 系统结算叙事落 eventLog（kind='settlement' 让 aiHistory 不带"玩家："前缀）
  store.applyEvent({ type: 'narrative', playerInput: '', aiMessage: narrative, kind: 'settlement' })

  // 世界公屏电报：from 是 AI 返回的中文势力名，归一化回内部代码
  if (chatter.length) {
    for (const c of chatter) {
      store.pushTelegram({
        gameDate: newDate,
        from: normalizeCommsFrom(c.from),
        content: c.content,
        channel: 'world',
        turn: store.turnCount,
        leaderName: c.name,
      })
    }
  }

  // 推进日期：入调度器走末尾蒙太奇（playTimeJump 含云雾演出 + toast）
  if (newDate !== snap.currentDate) {
    phase.value = 'advancing'
    progress.value = '推进日期…'
    scheduler.submit([{ order: 'setCurrentDate', date: newDate }], { authority: 'system' })
    await scheduler.advance()
    ensureCurrent(session)
  }

  phase.value = 'done'
  progress.value = '新回合开始'

  // 提取本回合新增事件作为摘要（排除回合开始前的历史事件）
  const newEvents = store.eventLog.slice(turnStartIdx)
  // 只有存在"有意义的事件"（非 routine）时才弹摘要
  const hasMeaningful = newEvents.some((e) => !isRoutineEvent(e))
  turnSummary.value = hasMeaningful ? newEvents : null

  const degraded = newEvents.some((e): e is AiStatus => e.type === 'aiStatus' && isAiDegraded(e))
  pushToast({ icon: degraded ? 'alert-triangle' : 'check', tone: degraded ? 'amber' : 'green',
    title: degraded ? '回合结束（AI 降级）' : '回合结束',
    text: degraded ? `日期推进至 ${newDate}；决策缺失与默认结算详见大事记。不自动重跑已结算行动。` : `日期推进至 ${newDate}` })
}

export function useAgentKernel() {
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
  }
}
