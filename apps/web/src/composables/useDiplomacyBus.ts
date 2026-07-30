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
} from '@/utils/diplomacy'
import { intentToRelationStatus, isInTruce } from '@/utils/diplomacy'

// ═══════════════════════════════════════════════════════════
//  模块级单例
// ═══════════════════════════════════════════════════════════

/** 当前进行中的协商 session（全局唯一） */
const currentSession = ref<DiplomacyRecord | null>(null)

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
   * - finalStance = accept 且 intent→关系态非 null → applyEvent relationChange（带 recordId 回链）
   * - finalStance = reject / counter 强制收口 → 只叙事，不改关系
   * - 若 settle 产出 worldTelegram → 推 world 频道
   * - record.status → 'settled'，upsert 归档
   */
  async function forceSettle(): Promise<{ narrative: string }> {
    const session = currentSession.value
    if (!session) return { narrative: '' }

    const lastRound = session.rounds[session.rounds.length - 1]
    const finalStance: DiplomacyStance = lastRound?.stance ?? 'reject'

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

        store.applyEvent({
          type: 'relationChange',
          a: session.playerFaction,
          b: session.targetFaction,
          status: rs,
          note: `${la}与${lb}经谈判达成${rs === 'alliance' ? '同盟' : rs === 'war' ? '宣战' : '停战'}协定`,
          recordId: session.id,
        })
        // toast
        const cfg = {
          war: { icon: 'sword', tone: 'cinnabar' as const, title: '宣战', text: `${la} 向 ${lb} 宣战` },
          alliance: { icon: 'affiliate', tone: 'green' as const, title: '结盟', text: `${la} 与 ${lb} 缔结同盟` },
          peace: { icon: 'player-stop', tone: 'neutral' as const, title: '停战', text: `${la} 与 ${lb} 罢兵言和` },
        }[rs]
        toast.push(cfg)
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
    currentSession.value = null
    toast.push({ icon: 'flag', tone: 'neutral', title: '谈判搁置', text: `与${targetLabel}的协商被搁置` })
  }

  // ═══════════════════════════════════════════════════════════
  //  公开接口
  // ═══════════════════════════════════════════════════════════

  return {
    currentSession,
    startDiplomacy,
    continueNegotiation,
    forceSettle,
    cancelDiplomacy,
    recoverSession,
  }
}
