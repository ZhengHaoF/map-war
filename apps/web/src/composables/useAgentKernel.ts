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

import { ref } from 'vue'
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
import type { DiplomaticProposal } from '@/utils/ai/factionAi'
import { AI_TELEGRAMS_PER_TURN } from '@/data/gameConfig'

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

/** 调用专属政权 AI，返回通过结构 + 战略校验的 GameOrder[] + 可选电报 + 可选外交提案。 */
async function invokeFactionAI(
  faction: Owner,
  context: string,
): Promise<FactionDecision> {
  const result = await decideFaction(faction, context)
  return result
}

/** 调用世界 AI 批量生成 minor 政权事件 */
async function invokeWorldAIBatch(_factions: Owner[], context: string): Promise<GameOrder[]> {
  const { orders: rawOrders, errors: rawErrors, parseSucceeded } = await runWorldBatch(context)

  // 仅解析失败才弹 toast；合法的空 orders（次要势力按兵不动）静默通过
  if (!parseSucceeded) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: '世界 AI 输出格式错误',
      text: 'AI 返回无法解析为 JSON',
    })
    useGameStore().applyEvent({ type: 'aiStatus', phase: 'batch', factions: _factions,
      status: 'failed', reason: 'format' })
    return []
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
  store.applyEvent({ type: 'aiStatus', phase: 'batch', factions: _factions,
    status: rawOrders.length !== strategicOk.length ? 'partial' : rawOrders.length ? 'ok' : 'empty',
    reason: rawOrders.length !== strategicOk.length ? 'filtered' : undefined })
  return strategicOk
}

/** 调用世界 AI 做 P4 总结（叙事 + 推进日期 + 世界公屏电报） */
async function invokeWorldAISettle(currentDate: string): Promise<WorldSettleResult> {
  return runWorldSettle(currentDate)
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

  loading.value = true
  lastError.value = ''
  phase.value = 'classifying'

  try {
    // 排空玩家残留指令
    phase.value = 'advancing'
    progress.value = '排空玩家残留指令…'
    await scheduler.advance()

    // 启动世界回合
    await runWorldTurn()
  } catch (err) {
    lastError.value = (err as Error).message || '未知错误'
    phase.value = 'error'
    pushToast({
      icon: 'alert-triangle',
      tone: 'cinnabar',
      title: '回合推演失败',
      text: lastError.value,
    })
  } finally {
    loading.value = false
    if (phase.value !== 'error') phase.value = 'done'
  }
}

/** P2→P3→P4 世界回合主循环 */
async function runWorldTurn(): Promise<void> {
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

  const allOrders: GameOrder[] = []

  // 并行：related 各自独立 + unrelated 批量一次
  // invokeFactionAI 返回 { orders, telegram }；invokeWorldAIBatch 返回 GameOrder[]
  const factionPromises: {
    faction: Owner
    promise: Promise<{
      orders: GameOrder[]
      telegram?: string
      diplomaticProposal?: DiplomaticProposal
    }>
  }[] = []
  const batchPromises: Promise<GameOrder[]>[] = []

  for (const f of related) {
    const ctx = buildFactionContext(f)
    factionPromises.push({ faction: f, promise: invokeFactionAI(f, ctx).then(result => {
      store.applyEvent({ type: 'aiStatus', phase: 'faction', factions: [f],
        ...(result.decisionStatus ?? { status: result.orders.length ? 'ok' as const : 'empty' as const }) })
      return result
    }, error => {
      store.applyEvent({ type: 'aiStatus', phase: 'faction', factions: [f], status: 'failed', reason: 'request' })
      throw error
    }) })
  }

  if (unrelated.length > 0) {
    const ctx = buildMinorContext(unrelated)
    batchPromises.push(invokeWorldAIBatch(unrelated, ctx).catch(error => {
      store.applyEvent({ type: 'aiStatus', phase: 'batch', factions: unrelated, status: 'failed', reason: 'request' })
      throw error
    }))
  }

  // 并行等待
  const [factionResults, batchResults] = await Promise.all([
    Promise.allSettled(factionPromises.map((p) => p.promise)),
    Promise.allSettled(batchPromises),
  ])

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
    if (r.status === 'fulfilled' && r.value.length) {
      allOrders.push(...r.value)
      for (const order of r.value) {
        const actor = normalizeCommsFrom((order as GameOrder & { actor: string }).actor) as Owner
        scheduler.submit([order], { authority: 'faction', actor, presentation })
      }
    }
  }

  // ── P3 推进（串行演出）──
  phase.value = 'advancing'
  progress.value = `执行 ${allOrders.length} 条指令…`
  await scheduler.advance()

  // ── P4a: 战斗裁决 ──
  const activeBattles = store.battles.filter((b) => b.active)
  if (activeBattles.length > 0) {
    phase.value = 'settling'
    progress.value = '战斗裁决中…'
    await scheduler.settleActiveBattles()
  }

  // ── P4 结算 ──
  phase.value = 'settling'
  progress.value = '世界 AI 总结中…'

  // P4 user 消息由 buildSettleContext 内部生成（#5.3：buildSettleContext 自取 sinceDateAdvance 历史）
  const { narrative, newDate, chatter, aiStatus } = await invokeWorldAISettle(snap.currentDate)
  store.applyEvent({ type: 'aiStatus', phase: 'settlement', factions: [],
    ...(aiStatus ?? { status: 'ok' }) })

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
    scheduler.submit([{ order: 'setCurrentDate', date: newDate }], { authority: 'system' })
    await scheduler.advance()
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
    endPlayerTurn,
    runWorldTurn,
  }
}
