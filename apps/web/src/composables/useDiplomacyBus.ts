/**
 * 三段式外交总线编排器（Phase2 核心）。
 *
 * 模块级单例 ref —— 会话期间 currentSession 唯一存在，跨组件复用。
 *
 * 生命周期：
 *   startDiplomacy （第一段路由 → 第二段初回）
 *     ↓
 *   continueNegotiation （第二段多轮，stance=counter 时玩家可回话）
 *     ↓
 *   forceSettle （第三段收口，叙事 + 关系改写 + 可选 world 通电）
 *     或 cancelDiplomacy （放弃，记录存 abandoned、不改关系）
 *
 * 持久化：每条 round 即时 upsert 进 store.diplomacyRecords（含 negotiating 态），
 * 读档后 recoverSession() 从 store 捞回 negotiating 记录重建 currentSession。
 */

import { ref } from 'vue'
import { invokeDiplomacyRoute, invokeDiplomacyReply, invokeDiplomacySettle } from '@/utils/aiDiplomacy'
import { useGameStore } from '@/stores/game'
import { useToast } from '@/composables/useToast'
import { OWNER_LABELS } from '@/data/owners'
import type { Owner } from '@/data/owners'
import type {
  DiplomacyIntent,
  DiplomacyStance,
  DiplomacyRound,
  DiplomacyRecord,
  Condition,
} from '@/utils/diplomacy'
import { intentToRelationStatus, isInTruce, INTENT_LABELS } from '@/utils/diplomacy'
import { resolveLocationId } from '@/utils/locationResolver'

// ═══════════════════════════════════════════════════════════
//  模块级单例
// ═══════════════════════════════════════════════════════════

/** 当前进行中的协商 session（全局唯一） */
const currentSession = ref<DiplomacyRecord | null>(null)

/**
 * 执行外交条件（割城/赔银/赔粮）。
 * 先校验后执行：任意一条校验失败则整体失败，不回滚已执行的条件（applyEvent 无回滚）。
 * @returns true=全部成功，false=某条件未达成
 */
function executeConditions(
  conditions: Condition[],
  playerFaction: Owner,
  targetFaction: Owner,
): boolean {
  const store = useGameStore()

  // 阶段一：预校验
  for (const c of conditions) {
    if (c.type === 'verbal') continue
    if (c.type === 'cedeCity') {
      if (!c.city) return false
      const gb = resolveLocationId(c.city)
      if (!gb) return false
      const city = store.cities[gb]
      if (!city || city.owner !== playerFaction) return false
    }
    if (c.type === 'transferSilver' || c.type === 'transferFood') {
      if (typeof c.amount !== 'number' || c.amount <= 0) return false
    }
  }

  // 阶段二：执行
  for (const c of conditions) {
    if (c.type === 'verbal') continue
    if (c.type === 'cedeCity') {
      const gb = resolveLocationId(c.city!)!
      store.applyEvent({ type: 'capture', targetGb: gb, actor: targetFaction })
    }
    if (c.type === 'transferSilver') {
      store.applyEvent({ type: 'treasuryChange', faction: playerFaction, delta: -c.amount!, reason: `外交条约：给付${OWNER_LABELS[targetFaction] ?? targetFaction}银两` })
      store.applyEvent({ type: 'treasuryChange', faction: targetFaction, delta: c.amount!, reason: `外交条约：接收${OWNER_LABELS[playerFaction] ?? playerFaction}银两` })
    }
    if (c.type === 'transferFood') {
      store.applyEvent({ type: 'granaryChange', faction: playerFaction, delta: -c.amount!, reason: `外交条约：给付${OWNER_LABELS[targetFaction] ?? targetFaction}粮草` })
      store.applyEvent({ type: 'granaryChange', faction: targetFaction, delta: c.amount!, reason: `外交条约：接收${OWNER_LABELS[playerFaction] ?? playerFaction}粮草` })
    }
  }

  return true
}

/** 暴露给面板的 reactive 引用 */
export function useDiplomacyBus() {
  const store = useGameStore()
  const toast = useToast()

  // ── 持久化辅助 ─────────────────────────────────────────────

  function persist(): void {
    if (currentSession.value) {
      store.upsertDiplomacyRecord(currentSession.value)
    }
  }

  /** 读档后从 store 恢复 negotiating 记录（若存在） */
  function recoverSession(): void {
    // 清理旧 session（避免重复恢复）
    currentSession.value = null
    const negotiating = store.diplomacyRecords.find((r) => r.status === 'negotiating')
    if (negotiating && negotiating.status === 'negotiating') {
      currentSession.value = negotiating
    }
  }

  // ── 第一段：发起外交 ──────────────────────────────────────

  /**
   * 玩家发起外交谈判。
   * 1. 调世界AI 路由（识别意图 + 校验合法性）
   * 2. 若不合法 → toast 错误 + return
   * 3. 若合法 → 创建 record、调第二段初回
   * 4. 第一轮入 record、持久化
   *
   * 返回：路由叙事（如"密使出发"），供面板展示
   */
  async function startDiplomacy(
    playerMessage: string,
    targetFaction: Owner,
  ): Promise<{ narrative: string; ok: boolean; reason?: string }> {
    const playerFaction = store.currentFaction
    if (!playerFaction) return { narrative: '', ok: false, reason: '请先选择势力' }
    if (targetFaction === playerFaction) return { narrative: '', ok: false, reason: '不能对自身发起外交' }

    currentSession.value = null // 覆盖旧 session（不允许同时两个）

    // 第一段：路由
    const route = await invokeDiplomacyRoute(playerFaction, targetFaction, playerMessage)
    if (!route.ok) {
      toast.push({ icon: 'flag', tone: 'cinnabar', title: '遣使被拒', text: route.reason ?? '外交路由校验未通过' })
      return { narrative: '', ok: false, reason: route.reason }
    }

    // 第二段：初回
    const reply = await invokeDiplomacyReply(playerFaction, targetFaction, route.intent, [], playerMessage)
    const round: DiplomacyRound = {
      round: 1,
      playerMessage,
      stance: reply.stance,
      reply: reply.reply,
      counterOffer: reply.counterOffer,
      conditions: reply.conditions,
    }

    const record: DiplomacyRecord = {
      id: `diplo_${Date.now()}`,
      playerFaction,
      targetFaction,
      intent: route.intent,
      rounds: [round],
      status: 'negotiating' as const,
      createdAt: store.currentDate,
    }
    currentSession.value = record
    persist()

    // toast 告知结果
    const targetLabel = OWNER_LABELS[targetFaction] ?? targetFaction
    if (reply.stance === 'accept') {
      toast.push({ icon: 'affiliate', tone: 'green', title: '对方同意', text: `${targetLabel}爽快应允` })
    } else if (reply.stance === 'reject') {
      toast.push({ icon: 'flag', tone: 'neutral', title: '遭婉拒', text: `${targetLabel}婉言谢绝` })
    } else {
      toast.push({ icon: 'affiliate', tone: 'amber', title: '反提议', text: `${targetLabel}提出条件` })
    }

    return { narrative: route.narrative, ok: true }
  }

  /**
   * AI 势力主动发起外交请求。
   * 当目标为玩家势力时：创建以 AI 为 initiator 的 DiplomacyRecord（status: 'negotiating'），推 Toast + 挂载使者到来。
   * 当目标为其他 AI 势力时：后台自动执行关系变更并记录。
   */
  function startAiDiplomacy(
    fromFaction: Owner,
    targetFaction: Owner,
    intent: DiplomacyIntent,
    message: string,
    conditions?: Condition[],
  ): DiplomacyRecord | null {
    if (fromFaction === targetFaction) return null

    const round: DiplomacyRound = {
      round: 1,
      playerMessage: '', // 玩家未发声，由 AI 主动发起
      stance: conditions && conditions.length > 0 ? 'counter' : 'accept',
      reply: message,
      conditions,
    }

    // 统一以当前玩家势力为 playerFaction 视角（若目标是玩家，playerFaction=玩家，targetFaction=AI；若目标是其他AI，playerFaction=targetFaction）
    const isTargetPlayer = targetFaction === store.currentFaction
    const record: DiplomacyRecord = {
      id: `diplo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      playerFaction: isTargetPlayer ? targetFaction : fromFaction,
      targetFaction: isTargetPlayer ? fromFaction : targetFaction,
      initiator: fromFaction,
      intent,
      rounds: [round],
      status: 'negotiating' as const,
      createdAt: store.currentDate,
    }

    // 若目标是玩家势力，拉起 session 并推送 Toast 提醒
    if (isTargetPlayer) {
      currentSession.value = record
      store.upsertDiplomacyRecord(record)
      const fromLabel = OWNER_LABELS[fromFaction] ?? fromFaction
      const intentLabel = INTENT_LABELS[intent] ?? intent
      toast.push({
        icon: 'affiliate',
        tone: 'amber',
        title: '【使者来访】',
        text: `${fromLabel}派遣密使致信，提出「${intentLabel}」意向`,
      })
      return record
    }

    // 若目标是其他 AI 势力，静默改写关系并归档
    const rs = intentToRelationStatus(intent)
    if (rs) {
      store.applyEvent({
        type: 'relationChange',
        a: fromFaction,
        b: targetFaction,
        status: rs,
        note: `${OWNER_LABELS[fromFaction] ?? fromFaction} 与 ${OWNER_LABELS[targetFaction] ?? targetFaction} 达成${rs === 'alliance' ? '同盟' : rs === 'war' ? '宣战' : '停战'}协定`,
        recordId: record.id,
      })
      record.status = 'settled'
      record.finalStance = 'accept'
      store.upsertDiplomacyRecord(record)
    }

    return record
  }

  // ── 第二段多轮：继续协商 ──────────────────────────────────

  /**
   * 玩家回应对方的 counter（或继续争取）。
   * 仅 stance=counter（或之前的轮次是 counter）时才应调用；accept/reject 后直接走 forceSettle。
   * 若对方回 accept/reject → 返回后面板应提示收口或自动收口。
   */
  async function continueNegotiation(
    playerMessage: string,
  ): Promise<{ round: DiplomacyRound; narrative?: string }> {
    const session = currentSession.value
    if (!session) return { round: { round: 0, playerMessage, stance: 'reject', reply: '（无进行中的协商）' } }

    const reply = await invokeDiplomacyReply(
      session.playerFaction,
      session.targetFaction,
      session.intent,
      session.rounds,
      playerMessage,
    )

    const round: DiplomacyRound = {
      round: session.rounds.length + 1,
      playerMessage,
      stance: reply.stance,
      reply: reply.reply,
      counterOffer: reply.counterOffer,
      conditions: reply.conditions,
    }
    session.rounds.push(round)
    persist()

    // 若对方 accept 或 reject 了，自动收口不改世界态（等面板显式调 forceSettle 或 自动 forceSettle）
    // 这里只做 toast 提示，收口权交面板
    const targetLabel = OWNER_LABELS[session.targetFaction] ?? session.targetFaction
    if (reply.stance === 'accept') {
      toast.push({ icon: 'affiliate', tone: 'green', title: '对方同意', text: `${targetLabel}应允了你的提议` })
    } else if (reply.stance === 'reject') {
      toast.push({ icon: 'flag', tone: 'cinnabar', title: '谈判破裂', text: `${targetLabel}最终拒绝` })
    }

    return { round }
  }

  // ── 第三段：收口 / 放弃 ──────────────────────────────────

  /**
   * 强制收口（第三段落入世界AI 叙事 + 关系改写）。
   *
   * 规则：
   * - playerAccepts=true（玩家点"同意协定"/"收口定论"且AI未拒绝）→ 视为双方达成，执行条件 + 改关系
   * - playerAccepts=false 或 AI 已 reject → 只叙事，不改关系
   * - 若 settle 产出 worldTelegram → 推 world 频道
   * - record.status → 'settled'，upsert 归档
   */
  async function forceSettle(playerAccepts: boolean = true): Promise<{ narrative: string }> {
    const session = currentSession.value
    if (!session) return { narrative: '' }

    const lastRound = session.rounds[session.rounds.length - 1]
    const aiStance: DiplomacyStance = lastRound?.stance ?? 'reject'

    // 有效立场：玩家同意 + AI 未拒绝 → accept；AI 已拒绝 → reject
    const finalStance: DiplomacyStance = (playerAccepts && aiStance !== 'reject') ? 'accept' : aiStance

    // 第三段：世界AI 收口叙事
    const settle = await invokeDiplomacySettle(
      session.playerFaction,
      session.targetFaction,
      session.intent,
      session.rounds,
      finalStance,
    )

    // 关系改写（仅 accept + 可映射意图）
    if (finalStance === 'accept') {
      // ── 可执行条件（割城/赔银/赔粮）──
      const conditions = lastRound?.conditions
      if (conditions && conditions.length > 0) {
        const condOk = executeConditions(conditions, session.playerFaction, session.targetFaction)
        if (!condOk) {
          // 条件执行失败，整笔交易作废（不改关系）
          toast.push({ icon: 'flag', tone: 'cinnabar' as const, title: '条约无法履行', text: '谈判条件未能执行，协定作废' })
          session.status = 'settled'
          session.finalStance = finalStance
          session.settleNarrative = settle.narrative
          persist()
          currentSession.value = null
          return { narrative: settle.narrative }
        }
      }

      const rs = intentToRelationStatus(session.intent)
      if (rs) {
        const la = OWNER_LABELS[session.playerFaction] ?? session.playerFaction
        const lb = OWNER_LABELS[session.targetFaction] ?? session.targetFaction

        // 停战冷却期校验：宣战时若在冷却期则拒绝，只叙事不改关系
        if (rs === 'war' && isInTruce(store.relations, session.playerFaction, session.targetFaction, store.currentDate)) {
          toast.push({ icon: 'flag', tone: 'cinnabar', title: '不可宣战', text: `与${lb}尚在停战冷却期，暂不可再战` })
          // 不改关系，但仍归档 + 叙事
          session.status = 'settled'
          session.finalStance = finalStance
          session.settleNarrative = settle.narrative
          persist()
          currentSession.value = null
          return { narrative: settle.narrative }
        }

        const r = store.applyEvent({
          type: 'relationChange',
          a: session.playerFaction,
          b: session.targetFaction,
          status: rs,
          note: `${la}与${lb}经谈判达成${rs === 'alliance' ? '同盟' : rs === 'war' ? '宣战' : '停战'}协定`,
          recordId: session.id,
        })
        if (!r.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[forceSettle] relationChange apply 失败: ${r.reason ?? '未知原因'}`, { a: session.playerFaction, b: session.targetFaction, status: rs })
          toast.push({ icon: 'flag', tone: 'error' as const, title: '关系改写失败', text: r.reason ?? '请重试或联系开发者' })
        } else {
          // toast
          const cfg = {
            war: { icon: 'sword', tone: 'cinnabar' as const, title: '宣战', text: `${la} 向 ${lb} 宣战` },
            alliance: { icon: 'affiliate', tone: 'green' as const, title: '结盟', text: `${la} 与 ${lb} 缔结同盟` },
            peace: { icon: 'player-stop', tone: 'neutral' as const, title: '停战', text: `${la} 与 ${lb} 罢兵言和` },
          }[rs]
          toast.push(cfg)
        }
      }
    }

    // world 通电（若有）
    if (settle.worldTelegram) {
      store.pushTelegram({
        channel: 'world',
        from: 'WORLD',
        content: settle.worldTelegram,
        gameDate: store.currentDate,
        turn: store.turnCount,
      })
    }

    // 归档
    session.status = 'settled'
    session.finalStance = finalStance
    session.settleNarrative = settle.narrative
    persist()

    // 外交收口后立即存档——relationChange 事件必须进 eventLog，
    // 否则下次读档 replay 重建 relations 时会丢失本次协定。
    store.save('auto', { label: `外交收口 ${store.currentDate}` })

    currentSession.value = null
    return { narrative: settle.narrative }
  }

  /** 放弃协商（不改关系，record 存 abandoned） */
  function cancelDiplomacy(): void {
    const session = currentSession.value
    if (!session) return

    const targetLabel = OWNER_LABELS[session.targetFaction] ?? session.targetFaction
    session.status = 'abandoned'
    persist()
    store.save('auto', { label: `搁置外交 ${store.currentDate}` })
    currentSession.value = null
    toast.push({ icon: 'flag', tone: 'neutral', title: '谈判搁置', text: `与${targetLabel}的协商被搁置` })
  }

  // ═══════════════════════════════════════════════════════════
  //  公开接口
  // ═══════════════════════════════════════════════════════════

  return {
    currentSession,
    startDiplomacy,
    startAiDiplomacy,
    continueNegotiation,
    forceSettle,
    cancelDiplomacy,
    recoverSession,
  }
}
