/**
 * Agent-Kernel 调度器（含 P4a 战斗结算）。
 *
 * 把「AI 返回的一批 GameOrder」当成一个待播放队列，按顺序串行消费：
 * - 普通指令直接走 executeOrder（规则校验 → 提交状态 → best-effort 演出；演出失败不改变已提交结果）；
 * - setCurrentDate 走 playTimeJump：云雾蒙太奇盖屏 → 中点改日期 → 揭开；
 * - 任意指令带 needsPlayerDecision=true 时停下，把控制权交还玩家（剩余项与日期指令保留在队列）。
 *
 * P4a 战斗结算：队列消费完后、dateAdvance 之前，遍历 ACTIVE 战斗逐场结算。
 *
 * 设计要点（来自 grill 结论）：
 * - 队列本身是运行时态。世界回合暂停时剩余项由 useAgentKernel 取回会话，可经
 *   exportPendingTurn/importPendingTurn 随手动存档恢复；未附带快照的存档读档后只结算、不重生成。
 * - reducer（applyEvent）完全不碰，本调度器只负责「何时消费、按什么顺序、是否停」。
 * - 同步不靠新锁：串行 for...await 一条播完才取下一条；现有重入锁在串行下不会触发。
 *
 * 模块级单例：调试面板与未来的玩家 UI 共享同一队列与推进循环。
 */

import { ref, toRaw } from 'vue'
import { executeOrder, playTimeJump, stopBattleVisual } from '@/utils/gameOrders'
import type { GameOrder } from '@/utils/gameOrders'
import type { ExecutionContext } from '@/utils/gameplayRules'
import { useToast, type ToastTone } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import type { BattleEndReason, CityState } from '@/stores/game'
import { flavorBattles } from '@/utils/ai'
import { computeBaseBattle, clampFlavor, checkMoraleCollapse } from '@/utils/battleFormula'
import type { BaseResult } from '@/utils/battleFormula'
import { distanceBetween } from '@/utils/locationResolver'
import { expeditionFactor } from '@/utils/economy'
import { getSupplyStatus, SUPPLY_PENALTY_LABEL } from '@/utils/supply'
import {
  BATTLE_MIN_ATTRITION_PER_ROUND,
  BATTLE_VICTORY_MORALE_ATTACKER,
  BATTLE_VICTORY_MORALE_DEFENDER,
  BATTLE_DEFEAT_MORALE_ATTACKER,
  BATTLE_DETERRENT_MORALE,
  BATTLE_DETERRENT_RADIUS_KM,
  OCCUPATION_CONSOLIDATION_TURNS,
} from '@/data/gameConfig'
import { battleSummaryText } from '@/utils/battleTrend'
import { Owner } from '@/data/owners'
import { commandReceipt, type BudgetSnapshot } from '@/utils/commandFeedback'
import type { LlmControlOpts } from '@/composables/useLlmClient'
import type { AiStatus } from '@/utils/aiStatus'

export type AdvanceStatus = 'idle' | 'running' | 'done' | 'stopped'

// ─── 模块级单例状态（调试面板 / 玩家 UI 共享同一队列）───
const queue = ref<GameOrder[]>([])
const executionContexts = new WeakMap<GameOrder, ExecutionContext>()
const status = ref<AdvanceStatus>('idle')
const stoppedAt = ref<GameOrder | null>(null)
const executionResults = ref<
  { order: GameOrder; ok: boolean; reason?: string; cost?: { silver: number; food: number } }[]
>([])
const { push: pushToast } = useToast()

/**
 * 把一批指令入队（不立即执行）。
 * @param orders 通过结构校验的 GameOrder 列表
 */
function submit(orders: GameOrder[], context: ExecutionContext = {}): void {
  // 身份在入队时锁定：未声明权限即玩家指令，行动者固定为入队时的当前势力（之后换势力不会改变 actor）
  const locked: ExecutionContext = context.authority
    ? { ...context }
    : { ...context, authority: 'player', actor: context.actor ?? useGameStore().currentFaction ?? undefined }
  for (const order of orders) executionContexts.set(toRaw(order), { ...locked })
  queue.value.push(...orders)
}

/**
 * P4a 战斗结算：本地公式为主干、AI 为调味层。
 */
async function settleActiveBattles(llmOpts?: LlmControlOpts,
  onAiStatus?: (outcome: Pick<AiStatus, 'status' | 'reason'>) => void,
  onAiWaiting?: (waiting: boolean) => void,
  guard?: () => void,
  onCommit?: () => void): Promise<void> {
  const store = useGameStore()
  guard?.()
  const active = store.battles.filter((b) => b.active)
  if (!active.length) return

  /**
   * 威慑扩散：计算 150km 范围内的指定势力城池，扣减士气
   */
  const applyDeterrentDiffusion = (centerGb: string, targetOwner: Owner, excludeGbs: string[]) => {
    if (!targetOwner || targetOwner === Owner.NEUTRAL) return
    const excludeSet = new Set(excludeGbs)
    for (const c of Object.values(store.cities as Record<string, CityState>)) {
      if (c.owner !== targetOwner || excludeSet.has(c.gb)) continue
      const dist = distanceBetween(centerGb, c.gb)
      if (dist !== null && dist <= BATTLE_DETERRENT_RADIUS_KM) {
        store.applyEvent({
          type: 'moraleChange',
          targetGb: c.gb,
          delta: BATTLE_DETERRENT_MORALE,
        })
      }
    }
  }

  /**
   * 结算单胜奖励与威慑扩散
   */
  const applySingleVictoryAndDeterrent = (
    snap: { from: string; to: string; attacker: Owner; defender: Owner },
    reason: BattleEndReason,
  ) => {
    if (reason === 'capture' || reason === 'defenderCollapse') {
      // 攻方胜：攻方来源城士气 +10
      store.applyEvent({
        type: 'moraleChange',
        targetGb: snap.from,
        delta: BATTLE_VICTORY_MORALE_ATTACKER,
      })
      // 败方（原守方）周边 150km 友城士气 -5
      applyDeterrentDiffusion(snap.to, snap.defender, [snap.to])
    } else if (reason === 'attackerRouted' || reason === 'attackerCollapse') {
      // 守方胜：守方城士气 +5
      store.applyEvent({
        type: 'moraleChange',
        targetGb: snap.to,
        delta: BATTLE_VICTORY_MORALE_DEFENDER,
      })
      // 攻方来源城溃败打击士气 -10
      store.applyEvent({
        type: 'moraleChange',
        targetGb: snap.from,
        delta: BATTLE_DEFEAT_MORALE_ATTACKER,
      })
      // 败方（攻方）周边 150km 友城士气 -5（排除交战城 snap.to 与来源城 snap.from）
      applyDeterrentDiffusion(snap.to, snap.attacker, [snap.to, snap.from])
    }
  }

  /**
   * 本地 helper：灭光柱 → applyEvent → toast（带战果摘要）。
   * 关键：快照必须在 applyEvent 之前取（reducer 处理 battleEnd 后会 filter 掉 BattleInfo）。
   */
  const endBattle = (
    id: string,
    reason: BattleEndReason,
    toast: { icon: string; tone: ToastTone; title: string; suffix?: string },
  ) => {
    // 快照：applyEvent 之前取累计数据
    const snap = store.battles.find((x) => x.id === id)
    const summary = snap ? battleSummaryText(snap) : ''
    stopBattleVisual(id)
    store.applyEvent({
      type: 'battleEnd',
      battleId: id,
      reason,
      fromName: snap?.fromName,
      toName: snap?.toName,
    })
    // 触发单胜奖励与威慑扩散
    if (snap) {
      applySingleVictoryAndDeterrent(snap, reason)
    }
    // toast 文案：标题 + 摘要 + 可选后缀（如进驻兵力）
    const parts = [summary, toast.suffix].filter(Boolean)
    pushToast({ icon: toast.icon, tone: toast.tone, title: toast.title, text: parts.join(' · ') })
  }

  // ── 第一阶段：前置检查 + 本地公式（不展示） ──
  const baseResults = new Map<string, BaseResult>()
  const supplyResults = new Map<string, boolean>()
  const validBattles: (typeof active)[number][] = []

  /** 本地公式：输入取第一阶段世界态（与调味请求同一快照）。 */
  const computeBase = (b: (typeof active)[number], from: CityState, to: CityState) => {
    const dist = b.marchDistanceKm ?? distanceBetween(b.from, b.to)
    const supply =
      b.supplyRulesVersion === 1
        ? getSupplyStatus(b.from, b.attacker, store.cities, store.turnCount)
        : undefined
    if (supply) supplyResults.set(b.id, supply.supplied)
    const supplyFactor = supply?.battleFactor ?? 1
    const distFactor = (dist !== null ? expeditionFactor(dist) : 1.0) * supplyFactor
    return computeBaseBattle({
      atkForce: from.fieldForce,
      defTroops: to.troops,
      atkMorale: from.morale,
      defMorale: to.morale,
      fort: to.fort ?? 0,
      terrain: to.terrain,
      distanceFactor: distFactor,
    })
  }

  for (const b of active) {
    const cities = store.cities as unknown as Record<string, CityState>
    const from = cities[b.from]
    const to = cities[b.to]
    if (!from || !to) continue

    // 偷家检测：攻方来源城已被第三方占领
    if (from.owner !== b.attacker) {
      endBattle(b.id, 'attackerRouted', {
        icon: 'skull',
        tone: 'error',
        title: '战线崩溃',
        suffix: `${b.fromName} 被占，前线溃散`,
      })
      continue
    }

    // 攻方来源城无外出兵力：本不该开战（开战入口已拦截），属异常兜底。
    if (from.fieldForce <= 0) {
      endBattle(b.id, 'retreat', {
        icon: 'player-stop',
        tone: 'neutral',
        title: '战线撤销',
        suffix: `${b.fromName} 未驻前线兵力，对峙作罢`,
      })
      continue
    }

    // 守方已归零 → 直接占领（跳过公式，无仗可打）
    if (to.troops <= 0) {
      const remaining = from.fieldForce
      store.applyEvent({
        type: 'capture',
        targetGb: b.to,
        actor: b.attacker,
        resultTroops: remaining,
        occupationTurns: b.supplyRulesVersion === 1 ? OCCUPATION_CONSOLIDATION_TURNS : undefined,
      })
      endBattle(b.id, 'capture', {
        icon: 'flag',
        tone: 'cinnabar',
        title: '城池陷落',
        suffix: `进驻 ${remaining}k`,
      })
      continue
    }

    // 本地公式：确定性基础减员 + 士气变化（远征衰减 + 补给系数）
    baseResults.set(b.id, computeBase(b, from, to))
    validBattles.push(b)
  }

  if (!validBattles.length) return

  // ── 第二阶段：AI 调味（尽力而为，失败不阻塞）───
  onAiWaiting?.(true)
  const flavorMap = await flavorBattles(validBattles, baseResults, outcome => {
    guard?.()
    onAiStatus?.(outcome)
    store.applyEvent({ type: 'aiStatus', phase: 'battleFlavor',
      factions: [...new Set(validBattles.flatMap(b => [b.attacker, b.defender]))], ...outcome })
  }, llmOpts).finally(() => { onAiWaiting?.(false) })
  // 跨 await 世界可能已被替换（读档/换局/换势力）：调用方会话失效则整体放弃，不落任何战果。
  guard?.()
  // 以下战果同步落地（无 await）：通知调用方本轮已进入提交，失败后不得重跑本轮。
  // 限制：逐条 applyEvent 非事务，中途异常不回滚已落地部分（at-most-once，非 exactly-once）。
  onCommit?.()
  // 注：基础公式与补给判定沿用第一阶段（即发给调味模型的同一快照），await 期间的数值变化
  // 不改写本轮公式；但战线存活/双方归属/攻方兵力在落地前逐条重验，避免对已易主的城结算。

  // ── 第三阶段：钳制 AI 调味 + 合并 + apply ──
  for (const b of validBattles) {
    const cities = store.cities as unknown as Record<string, CityState>
    const from = cities[b.from]
    const to = cities[b.to]
    if (!from || !to) continue
    // 重验：战线仍在、双方归属未变、攻方仍有前线兵力；否则不按旧前提结算。
    if (!store.battles.some((x) => x.id === b.id && x.active)) continue
    if (from.owner !== b.attacker) {
      endBattle(b.id, 'attackerRouted', {
        icon: 'skull', tone: 'error', title: '战线崩溃', suffix: `${b.fromName} 被占，前线溃散`,
      })
      continue
    }
    if (to.owner !== b.defender || from.fieldForce <= 0) {
      endBattle(b.id, 'retreat', {
        icon: 'player-stop', tone: 'neutral', title: '战线撤销',
        suffix: to.owner !== b.defender ? `${b.toName} 已易主，对峙作罢` : `${b.fromName} 未驻前线兵力，对峙作罢`,
      })
      continue
    }
    if (to.troops <= 0) {
      const remaining = from.fieldForce
      store.applyEvent({
        type: 'capture', targetGb: b.to, actor: b.attacker, resultTroops: remaining,
        occupationTurns: b.supplyRulesVersion === 1 ? OCCUPATION_CONSOLIDATION_TURNS : undefined,
      })
      endBattle(b.id, 'capture', { icon: 'flag', tone: 'cinnabar', title: '城池陷落', suffix: `进驻 ${remaining}k` })
      continue
    }

    const base = baseResults.get(b.id)!
    const rawFlavor = flavorMap[b.id] ?? { events: [] }
    const flavor = clampFlavor(rawFlavor, base)

    // 合并：基础 + AI shock 突发减员
    let attackerShock = 0
    let defenderShock = 0
    for (const e of flavor.events) {
      if (e.type === 'shock') {
        if (e.side === 'attacker') attackerShock += e.magnitude ?? 0
        else defenderShock += e.magnitude ?? 0
      }
    }
    const finalAttackerLoss = Math.min(
      Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.attackerLoss + attackerShock),
      from.fieldForce,
    )
    const finalDefenderLoss = Math.min(
      Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.defenderLoss + defenderShock),
      to.troops,
    )

    // applyEvent(attack) — 兵力损耗
    store.applyEvent({
      type: 'attack',
      fromGb: b.from,
      targetGb: b.to,
      attackerLoss: finalAttackerLoss,
      defenderLoss: finalDefenderLoss,
      narrative:
        b.supplyRulesVersion === 1
          ? [
              flavor.narrative,
              supplyResults.get(b.id) ? '本轮补给通畅。' : `本轮${SUPPLY_PENALTY_LABEL}。`,
            ]
              .filter(Boolean)
              .join(' ')
          : flavor.narrative,
    })

    // applyEvent(moraleChange) — 公式士气损耗
    if (base.atkMoraleDelta !== 0) {
      store.applyEvent({
        type: 'moraleChange',
        targetGb: b.from,
        delta: base.atkMoraleDelta,
      })
    }
    if (base.defMoraleDelta !== 0) {
      store.applyEvent({
        type: 'moraleChange',
        targetGb: b.to,
        delta: base.defMoraleDelta,
      })
    }

    // applyEvent(moraleChange) — AI 士气扰动
    for (const e of flavor.events) {
      if (e.type === 'morale') {
        const targetGb = e.side === 'attacker' ? b.from : b.to
        store.applyEvent({
          type: 'moraleChange',
          targetGb,
          delta: e.delta ?? 0,
        })
      }
    }

    // ── 第四阶段：终局复检 ──
    const currentCities = store.cities as unknown as Record<string, CityState>
    const finalFrom = currentCities[b.from]
    const finalTo = currentCities[b.to]
    if (!finalFrom || !finalTo) continue

    // ② 士气崩溃（优先于归零，守方优先判定）
    const collapse = checkMoraleCollapse({
      battleId: b.id,
      turns: store.battles.find((x) => x.id === b.id)?.turns ?? 0,
      atkMorale: finalFrom.morale,
      defMorale: finalTo.morale,
    })
    if (collapse === 'defender') {
      store.applyEvent({
        type: 'capture',
        targetGb: b.to,
        actor: b.attacker,
        resultTroops: finalFrom.fieldForce,
        occupationTurns: b.supplyRulesVersion === 1 ? OCCUPATION_CONSOLIDATION_TURNS : undefined,
      })
      endBattle(b.id, 'defenderCollapse', {
        icon: 'flag',
        tone: 'purple',
        title: '城池陷落',
        suffix: '守军士气崩溃',
      })
      continue
    }
    if (collapse === 'attacker') {
      endBattle(b.id, 'attackerCollapse', {
        icon: 'skull',
        tone: 'purple',
        title: '攻方溃败',
        suffix: '攻军士气崩溃',
      })
      continue
    }

    // ① 兵力归零（原逻辑保留）
    if (finalTo.troops <= 0) {
      const remaining = finalFrom.fieldForce
      store.applyEvent({
        type: 'capture',
        targetGb: b.to,
        actor: b.attacker,
        resultTroops: remaining,
        occupationTurns: b.supplyRulesVersion === 1 ? OCCUPATION_CONSOLIDATION_TURNS : undefined,
      })
      endBattle(b.id, 'capture', {
        icon: 'flag',
        tone: 'cinnabar',
        title: '城池陷落',
        suffix: `进驻 ${remaining}k`,
      })
    } else if (finalFrom.fieldForce <= 0) {
      endBattle(b.id, 'attackerRouted', {
        icon: 'skull',
        tone: 'error',
        title: '攻方溃败',
        suffix: '兵锋耗尽',
      })
    }
  }
}

/** 队列条目：指令 + 入队时的执行上下文（权限/行动者），用于暂停后的无损交接与恢复。 */
export interface QueuedOrder {
  order: GameOrder
  context: ExecutionContext
}

export interface AdvanceOptions {
  /**
   * 每条指令执行前调用；抛错表示调用方会话已失效（读档/换局/换势力）。
   * 抛错时尚未执行的指令（含日期指令）原样留在队列中，状态复位为 idle，错误继续上抛。
   */
  guard?: () => void
}

function isSystemDate(o: GameOrder): boolean {
  const context = executionContexts.get(toRaw(o)) ?? {}
  return o.order === 'setCurrentDate'
    && (context.authority === 'system' || context.authority === 'debug')
}

/** 取走队列中全部待执行项（含上下文）并清空队列；供上层把暂停中的世界指令移出公共队列。 */
function detachQueue(): QueuedOrder[] {
  if (status.value === 'running') throw new Error('调度器正在推进，不能取走队列')
  const entries = queue.value.map((order): QueuedOrder => {
    const context = executionContexts.get(toRaw(order))
    return { order, context: context ? { ...context } : {} }
  })
  queue.value = []
  stoppedAt.value = null
  if (status.value === 'stopped') status.value = 'idle'
  return entries
}

/** 把 detachQueue 取出的条目按原上下文放回队尾。 */
function restoreQueue(entries: QueuedOrder[]): void {
  for (const entry of entries) submit([entry.order], entry.context)
}

/**
 * 日期指令必须恰好提交一次：演出失败时若 dateAdvance 尚未落日志则直接补记，
 * 已在演出中点提交则不重复。
 */
async function commitDate(order: GameOrder, guard?: () => void): Promise<void> {
  const store = useGameStore()
  const startLen = store.eventLog.length
  const committed = () => store.eventLog.slice(startLen)
    .some(e => e.type === 'dateAdvance' && e.date === order.date)
  try {
    await playTimeJump(order.date!, guard)
  } catch (e) {
    // 会话失效（guard 抛错）不得被当作演出失败吞掉，更不能补记日期
    guard?.()
    // eslint-disable-next-line no-console
    console.warn('[scheduler] 时间推进演出失败，直接提交日期：', e)
  }
  if (!committed()) {
    guard?.()
    store.applyEvent({ type: 'dateAdvance', date: order.date! })
  }
}

/**
 * 串行推进队列：逐条消费直到跑完或遇到 needsPlayerDecision。
 * 不结算战斗（P4a 已移至 useAgentKernel.runWorldTurn 的 P3 推进之后）。
 *
 * 不变量：
 * - 日期指令（system/debug 的 setCurrentDate）总在非日期指令之后执行；遇停点、guard 失效或
 *   内部异常提前返回时，未执行的日期指令仍留在队列中，不会丢失也不会提前执行。
 * - 已出队的指令不会被重放（避免双重扣费）；单条 executeOrder 异常只记失败并继续。
 * @returns 'done' 队列跑空；'stopped' 遇到停标交还玩家（剩余项仍在 queue）；
 *          'running' 已在推进中（本次调用什么也没做，调用方不得当作完成）
 */
async function advance(options: AdvanceOptions = {}): Promise<'done' | 'stopped' | 'running'> {
  const store = useGameStore()
  if (status.value === 'running') return 'running'
  if (!queue.value.length) {
    status.value = 'done'
    stoppedAt.value = null
    return 'done'
  }

  status.value = 'running'
  stoppedAt.value = null
  executionResults.value = []
  // 日期指令留在本地，但任何提前返回都会放回队尾（见 finally）。
  const dateOrders = queue.value.filter(isSystemDate)
  queue.value = queue.value.filter(o => !isSystemDate(o))
  let datesSettled = false
  try {
    // P1 + P3：消费所有非日期指令
    while (queue.value.length) {
      options.guard?.()
      const order = queue.value.shift()!
      const context = executionContexts.get(toRaw(order)) ?? {}
      const actor = context.actor ?? store.currentFaction
      const record = actor && context.authority !== 'debug' && context.authority !== 'system'
      const budget = (): BudgetSnapshot => ({
        points: actor ? store.getActionPoints(actor) : 0,
        silver: actor ? store.getTreasury(actor) : 0,
        food: actor ? store.getGranary(actor) : 0,
      })
      const before = budget()
      try {
        const result = await executeOrder(order, context)
        executionResults.value.push({
          order,
          ok: result.ok,
          reason: result.reason,
          cost: result.cost,
        })
      } catch (e) {
        // 单条失败不打断整批：告警后继续下一条
        // eslint-disable-next-line no-console
        console.warn('[scheduler] 指令执行失败，跳过：', order, e)
        executionResults.value.push({ order, ok: false, reason: '执行异常，未完成' })
        pushToast({
          icon: 'alert-triangle',
          tone: 'error',
          title: '指令出错',
          text: '推演中一条指令失败，已跳过',
        })
      }
      // 跨 await 后先确认会话仍有效，再写回执/停点；不放在 catch 内，避免被指令错误吞掉
      options.guard?.()
      if (record) {
        const result = executionResults.value[executionResults.value.length - 1]
        store.applyEvent(commandReceipt(actor, order, result, before, budget()))
      }

      // 世界 AI 标注「需玩家决策」→ 在此停下交还
      if (order.needsPlayerDecision) {
        // 落一条停点事件进 eventLog，让读档重放也能还原「此处该玩家拍板」。
        // 它是末尾事件时 pausedForPlayer 才为真；玩家决策产生新事件后自动解除。
        store.applyEvent({ type: 'pauseForPlayer' })
        stoppedAt.value = order
        status.value = 'stopped'
        pushToast({
          icon: 'alert-triangle',
          tone: 'cinnabar',
          title: '请主公定夺',
          text: '局势有变，控制权已交还',
        })
        return 'stopped'
      }
    }

    // P4b：时间推进（云雾蒙太奇 + 日期变更），每条恰好提交一次
    while (dateOrders.length) {
      options.guard?.()
      // 先 peek，提交成功后才出队：提交失败（含 guard 失效）时该日期仍留在可恢复队列
      await commitDate(dateOrders[0]!, options.guard)
      dateOrders.shift()
    }
    datesSettled = true

    stoppedAt.value = null
    status.value = 'done'
    return 'done'
  } finally {
    if (!datesSettled && dateOrders.length) queue.value = [...queue.value, ...dateOrders]
    // guard 失效或内部异常：不伪装成 done，复位为 idle 并让错误上抛
    if (status.value === 'running') status.value = 'idle'
  }
}

export function useGameScheduler() {
  return { queue, status, stoppedAt, executionResults, submit, advance, detachQueue, restoreQueue,
    settleActiveBattles }
}
