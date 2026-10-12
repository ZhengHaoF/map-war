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

import { ref, watch } from 'vue'
import {
  invokeDiplomacyRoute,
  invokeDiplomacyReply,
  invokeDiplomacySettle,
} from '@/utils/aiDiplomacy'
import { useGameStore, type GameEvent } from '@/stores/game'
import { useToast } from '@/composables/useToast'
import { OWNER_LABELS } from '@/data/owners'
import { countryName } from '@/data/worldCountries'
import type { Owner } from '@/data/owners'
import type {
  DiplomacyIntent,
  DiplomacyStance,
  DiplomacyRound,
  DiplomacyRecord,
  Condition,
  AidOffer,
} from '@/utils/diplomacy'
import {
  intentToRelationStatus,
  isInTruce,
  INTENT_LABELS,
  isCountryTarget,
  readRelation,
} from '@/utils/diplomacy'
import { resolveLocationId } from '@/utils/locationResolver'
import { OCCUPATION_CONSOLIDATION_TURNS } from '@/data/gameConfig'
import type { LlmControlOpts } from '@/composables/useLlmClient'
import { AiWaitError, withAiAbort } from '@/utils/aiWait'

// ═══════════════════════════════════════════════════════════
//  模块级单例
// ═══════════════════════════════════════════════════════════

/** 当前进行中的协商 session（全局唯一） */
const currentSession = ref<DiplomacyRecord | null>(null)
const diplomacyEpoch = ref(0)

/** Every async diplomacy request belongs to one world and one negotiation generation. */
async function inCurrentWorld<T>(
  store: ReturnType<typeof useGameStore>,
  invoke: (control: LlmControlOpts) => Promise<T>,
): Promise<T | null> {
  const generation = [store.reloadToken, store.currentFaction, diplomacyEpoch.value]
  const controller = new AbortController()
  const stop = watch([() => store.reloadToken, () => store.currentFaction, diplomacyEpoch], () => {
    controller.abort(new AiWaitError('superseded'))
  }, { flush: 'sync' })
  const timer = setTimeout(() => controller.abort(new AiWaitError('timeout')), 90_000)
  try {
    const result = await withAiAbort(() => invoke({ signal: controller.signal, attemptTimeoutMs: 90_000 }),
      controller.signal)
    if (generation[0] !== store.reloadToken || generation[1] !== store.currentFaction ||
      generation[2] !== diplomacyEpoch.value || controller.signal.aborted) return null
    return result
  } catch {
    return null
  } finally {
    stop()
    clearTimeout(timer)
  }
}

function planConditions(conditions: Condition[], payer: Owner, recipient?: Owner): GameEvent[] | null {
  const store = useGameStore()
  const events: GameEvent[] = []
  let silver = 0, food = 0
  const ceded = new Set<string>()
  for (const c of conditions) {
    if (c.type === 'verbal') continue
    if (c.type === 'cedeCity') {
      const gb = c.city ? resolveLocationId(c.city) : null
      if (!recipient || !gb || ceded.has(gb) || store.cities[gb]?.owner !== payer) return null
      ceded.add(gb)
      events.push({ type: 'capture', targetGb: gb, actor: recipient, occupationTurns: OCCUPATION_CONSOLIDATION_TURNS })
    } else if (c.type === 'transferSilver' || c.type === 'transferFood') {
      if (!Number.isFinite(c.amount) || c.amount! <= 0 || c.amount! > 500) return null
      const type = c.type === 'transferSilver' ? 'treasuryChange' : 'granaryChange'
      if (type === 'treasuryChange') silver += c.amount!
      else food += c.amount!
      events.push({ type, faction: payer, delta: -c.amount!, reason: '外交履约' })
      if (recipient) events.push({ type, faction: recipient, delta: c.amount!, reason: '外交履约' })
    } else return null
  }
  if (store.getTreasury(payer) < silver || store.getGranary(payer) < food) return null
  return events
}
function planAid(offers: AidOffer[], recipient: Owner): GameEvent[] | null {
  const store = useGameStore()
  const events: GameEvent[] = []
  for (const offer of offers) {
    if (!Number.isFinite(offer.amount) || offer.amount <= 0) return null
    if (offer.type === 'military') {
      const gb = offer.targetCity ? resolveLocationId(offer.targetCity) : null
      if (!gb || store.cities[gb]?.owner !== recipient || offer.amount > 100) return null
      events.push({ type: 'produce', targetGb: gb, amount: offer.amount })
    } else if (offer.type === 'silver' || offer.type === 'food') {
      if (offer.amount > 500) return null
      events.push({ type: offer.type === 'silver' ? 'treasuryChange' : 'granaryChange',
        faction: recipient, delta: offer.amount, reason: '国家援助' })
    } else return null
  }
  return events
}

/** 组装条约摘要（确定性拼接，入 eventLog 供所有 AI 在历史时间线里读到） */
function formatTreatySummary(
  countryIso: string,
  conditions: Condition[] | undefined,
  aidOffers: AidOffer[] | undefined,
): string {
  const label = countryName(countryIso)
  const parts: string[] = []
  if (aidOffers?.length) {
    for (const o of aidOffers) {
      const amount = `${o.amount}${o.type === 'military' ? '千' : '万'}`
      parts.push(
        o.type === 'military'
          ? `援军${amount}于${o.targetCity ?? '?'}`
          : o.type === 'silver'
            ? `助饷${amount}银`
            : `济粮${amount}石`,
      )
    }
  }
  const promises =
    conditions
      ?.filter((c) => c.type === 'verbal')
      .map((c) => c.text)
      .filter(Boolean) ?? []
  const costParts: string[] = []
  for (const c of conditions ?? []) {
    if (c.type === 'transferSilver') costParts.push(`付银${c.amount}万`)
    if (c.type === 'transferFood') costParts.push(`付粮${c.amount}万石`)
  }
  const head = `《${label}协定》成`
  const body = [
    parts.length ? parts.join('、') : '',
    costParts.length ? costParts.join('、') : '',
    ...promises,
  ]
    .filter(Boolean)
    .join('；')
  return `${head}：${body}`
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
    diplomacyEpoch.value++
    // 清理旧 session（避免重复恢复）
    currentSession.value = null
    const negotiating = [...store.diplomacyRecords].reverse().find((r) =>
      r.status === 'negotiating' && r.playerFaction === store.currentFaction)
    if (negotiating && negotiating.status === 'negotiating') {
      currentSession.value = negotiating
    }
  }

  // ── 第一段：发起外交 ──────────────────────────────────────

  /**
   * 玩家发起外交谈判（目标可为中国势力或列强国家）。
   * 1. 调世界AI 路由（识别意图 + 校验合法性）
   * 2. 若不合法 → toast 错误 + return
   * 3. 若合法 → 创建 record、调第二段初回
   * 4. 第一轮入 record、持久化
   *
   * @param targetFaction 势力目标（与 targetCountry 二选一）
   * @param targetCountry 国家目标 iso_a3（与 targetFaction 二选一）
   */
  async function startDiplomacy(
    playerMessage: string,
    targetFaction: Owner | null,
    targetCountry?: string,
  ): Promise<{ narrative: string; ok: boolean; reason?: string }> {
    const playerFaction = store.currentFaction
    if (!playerFaction) return { narrative: '', ok: false, reason: '请先选择势力' }
    if (!targetFaction && !targetCountry)
      return { narrative: '', ok: false, reason: '请选择遣使目标' }
    if (targetFaction === playerFaction)
      return { narrative: '', ok: false, reason: '不能对自身发起外交' }

    diplomacyEpoch.value++
    if (currentSession.value) {
      currentSession.value.status = 'abandoned'
      persist()
    }
    currentSession.value = null // 覆盖旧 session（不允许同时两个）

    // 第一段：路由
    const route = await inCurrentWorld(store, control => invokeDiplomacyRoute(
      playerFaction,
      targetFaction,
      playerMessage,
      targetCountry,
      control,
    ))
    if (!route) return { narrative: '', ok: false, reason: '外交请求已取消或过期' }
    if (!route.ok) {
      toast.push({
        icon: 'flag',
        tone: 'cinnabar',
        title: '遣使被拒',
        text: route.reason ?? '外交路由校验未通过',
      })
      return { narrative: '', ok: false, reason: route.reason }
    }

    // 第二段：初回
    const reply = await inCurrentWorld(store, control => invokeDiplomacyReply(
      playerFaction,
      targetFaction,
      route.intent,
      [],
      playerMessage,
      targetCountry,
      control,
    ))
    if (!reply) return { narrative: '', ok: false, reason: '外交请求已取消或过期' }
    const round: DiplomacyRound = {
      round: 1,
      playerMessage,
      stance: reply.stance,
      reply: reply.reply,
      counterOffer: reply.counterOffer,
      conditions: reply.conditions,
      aidOffer: reply.aidOffer,
    }

    const record: DiplomacyRecord = {
      id: `diplo_${Date.now()}`,
      playerFaction,
      targetFaction: targetFaction ?? undefined,
      targetCountry,
      intent: route.intent,
      rounds: [round],
      status: 'negotiating' as const,
      createdAt: store.currentDate,
    }
    currentSession.value = record
    persist()

    // toast 告知结果
    const targetLabel = targetCountry
      ? countryName(targetCountry)
      : (OWNER_LABELS[targetFaction!] ?? targetFaction!)
    if (reply.stance === 'accept') {
      toast.push({
        icon: 'affiliate',
        tone: 'green',
        title: '对方同意',
        text: `${targetLabel}爽快应允`,
      })
    } else if (reply.stance === 'reject') {
      toast.push({ icon: 'flag', tone: 'neutral', title: '遭婉拒', text: `${targetLabel}婉言谢绝` })
    } else {
      toast.push({
        icon: 'affiliate',
        tone: 'amber',
        title: '反提议',
        text: `${targetLabel}提出条件`,
      })
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
    if (!store.activeFactions.includes(fromFaction) || !store.activeFactions.includes(targetFaction)) return null
    if (intent === 'war' && isInTruce(store.relations, fromFaction, targetFaction, store.currentDate)) return null

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
      if (currentSession.value?.status === 'negotiating') return null
      diplomacyEpoch.value++
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

    // The recipient has a distinct deterministic consent policy. A proposal is not consent.
    const rs = intentToRelationStatus(intent)
    if (rs) {
      const relation = readRelation(store.relations, fromFaction, targetFaction)
      const mutualEnemy = store.activeFactions.some(other => other !== fromFaction && other !== targetFaction
        && readRelation(store.relations, fromFaction, other).status === 'war'
        && readRelation(store.relations, targetFaction, other).status === 'war')
      const accepted = !conditions?.length && (
        intent === 'war' || intent === 'breakAlliance' ||
        (intent === 'alliance' && relation.status !== 'war' && mutualEnemy) ||
        (intent === 'peace' && (relation.status !== 'war' ||
          store.factionTroops(targetFaction) < store.factionTroops(fromFaction))))
      if (!accepted) {
        record.status = 'settled'
        record.finalStance = 'reject'
        record.settleNarrative = '目标势力依据当前关系与共同威胁拒绝提案；未改变关系或执行条件。'
        store.upsertDiplomacyRecord(record)
        return record
      }
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
    if (!session)
      return { round: { round: 0, playerMessage, stance: 'reject', reply: '（无进行中的协商）' } }

    const reply = await inCurrentWorld(store, control => invokeDiplomacyReply(
      session.playerFaction,
      session.targetFaction ?? null,
      session.intent,
      session.rounds,
      playerMessage,
      session.targetCountry,
      control,
    ))
    if (!reply || currentSession.value?.id !== session.id)
      return { round: { round: 0, playerMessage, stance: 'reject', reply: '（协商已取消或过期）' } }

    const round: DiplomacyRound = {
      round: session.rounds.length + 1,
      playerMessage,
      stance: reply.stance,
      reply: reply.reply,
      counterOffer: reply.counterOffer,
      conditions: reply.conditions,
      aidOffer: reply.aidOffer,
    }
    session.rounds.push(round)
    persist()

    // 若对方 accept 或 reject 了，自动收口不改世界态（等面板显式调 forceSettle 或 自动 forceSettle）
    // 这里只做 toast 提示，收口权交面板
    const targetLabel = session.targetCountry
      ? countryName(session.targetCountry)
      : (OWNER_LABELS[session.targetFaction!] ?? session.targetFaction!)
    if (reply.stance === 'accept') {
      toast.push({
        icon: 'affiliate',
        tone: 'green',
        title: '对方同意',
        text: `${targetLabel}应允了你的提议`,
      })
    } else if (reply.stance === 'reject') {
      toast.push({
        icon: 'flag',
        tone: 'cinnabar',
        title: '谈判破裂',
        text: `${targetLabel}最终拒绝`,
      })
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
    const finalStance: DiplomacyStance =
      playerAccepts && aiStance !== 'reject' ? 'accept' : 'reject'

    // 第三段：世界AI 收口叙事
    const settle = await inCurrentWorld(store, control => invokeDiplomacySettle(
      session.playerFaction,
      session.targetFaction ?? null,
      session.intent,
      session.rounds,
      finalStance,
      session.targetCountry,
      control,
    ))
    if (!settle || currentSession.value?.id !== session.id) return { narrative: '' }

    // 收口执行（仅 accept）
    if (finalStance === 'accept') {
      if (isCountryTarget(session)) {
        // ── 国家分支：玩家偿付 ⇄ 国家援助，一笔两清 ──
        const conditions = lastRound?.conditions
        const offers = lastRound?.aidOffer
        const costsOk =
          !conditions?.length ||
          conditions.every(
            (c) =>
              c.type === 'verbal' ||
              ((c.type === 'transferSilver' || c.type === 'transferFood') &&
                typeof c.amount === 'number' &&
                c.amount > 0),
          )
        let aidOk = !offers?.length
        if (offers?.length) {
          aidOk = offers.every((o) => {
            if (typeof o.amount !== 'number' || o.amount <= 0) return false
            if (o.type !== 'military') return true
            const gb = o.targetCity ? resolveLocationId(o.targetCity) : undefined
            const city = gb ? store.cities[gb] : undefined
            return !!city && city.owner === session.playerFaction
          })
        }
        if (!costsOk || !aidOk) {
          toast.push({
            icon: 'flag',
            tone: 'cinnabar' as const,
            title: '条约无法履行',
            text: '偿付或援助条目无效，协定作废',
          })
          session.status = 'settled'
          session.finalStance = 'reject'
          session.settleNarrative = '条约条件无法履行；未改变关系或提交费用。'
          persist()
          currentSession.value = null
          return { narrative: session.settleNarrative }
        }
        const costEvents = planConditions(conditions ?? [], session.playerFaction)
        const aidEvents = planAid(offers ?? [], session.playerFaction)
        if (!costEvents || !aidEvents || !store.applyEvents([...costEvents, ...aidEvents]).ok) {
          toast.push({ icon: 'flag', tone: 'cinnabar', title: '条约无法履行', text: '整批预算不足或援助无效，未提交任何费用或收益' })
          return { narrative: '' }
        }
        // 条约 narrative 事件入 eventLog（kind=settlement）——
        // 此后所有 AI 从历史时间线（buildEventHistory）读到条约与玩家履约情况，形成信誉判断
        store.applyEvent({
          type: 'narrative',
          playerInput: '',
          aiMessage: `${formatTreatySummary(session.targetCountry!, conditions, offers)}。${settle.narrative}`,
          kind: 'settlement',
        })
        // 国家不在关系矩阵——aid 意图不改 relations
        if (settle.worldTelegram) {
          store.pushTelegram({
            channel: 'world',
            from: 'WORLD',
            content: settle.worldTelegram,
            gameDate: store.currentDate,
            turn: store.turnCount,
          })
        }
        session.status = 'settled'
        session.finalStance = finalStance
        session.settleNarrative = settle.narrative
        persist()
        store.save('auto', { label: `外援协定 ${store.currentDate}` })
        currentSession.value = null
        toast.push({
          icon: 'affiliate',
          tone: 'green' as const,
          title: '外援协定达成',
          text: `${countryName(session.targetCountry!)} 的援助已到账`,
        })
        return { narrative: settle.narrative }
      }

      // ── 势力分支：可执行条件（割城/赔银/赔粮）──
      const conditions = lastRound?.conditions
      const rs = intentToRelationStatus(session.intent)
      if (rs === 'war' && session.targetFaction &&
        isInTruce(store.relations, session.playerFaction, session.targetFaction, store.currentDate))
        return { narrative: '双方尚在停战期，未执行费用或宣战。' }
      const treaty = planConditions(conditions ?? [], session.playerFaction, session.targetFaction)
      if (rs && session.targetFaction && treaty)
        treaty.push({ type: 'relationChange', a: session.playerFaction, b: session.targetFaction,
          status: rs, recordId: session.id, note: '双方外交协定' })
      {
        const condOk = !!treaty && store.applyEvents(treaty).ok
        if (!condOk) {
          // 条件执行失败，整笔交易作废（不改关系）
          toast.push({
            icon: 'flag',
            tone: 'cinnabar' as const,
            title: '条约无法履行',
            text: '谈判条件未能执行，协定作废',
          })
          session.status = 'settled'
          session.finalStance = 'reject'
          session.settleNarrative = '条约条件无法履行；未改变关系或提交费用。'
          persist()
          currentSession.value = null
          return { narrative: session.settleNarrative }
        }
      }

      if (rs && session.targetFaction) {
        const la = OWNER_LABELS[session.playerFaction] ?? session.playerFaction
        const lb = OWNER_LABELS[session.targetFaction] ?? session.targetFaction

        const cfg = {
            war: {
              icon: 'sword',
              tone: 'cinnabar' as const,
              title: '宣战',
              text: `${la} 向 ${lb} 宣战`,
            },
            alliance: {
              icon: 'affiliate',
              tone: 'green' as const,
              title: '结盟',
              text: `${la} 与 ${lb} 缔结同盟`,
            },
            peace: {
              icon: 'player-stop',
              tone: 'neutral' as const,
              title: '停战',
              text: `${la} 与 ${lb} 罢兵言和`,
            },
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

    // 外交收口后立即存档——relationChange 事件必须进 eventLog，
    // 否则下次读档 replay 重建 relations 时会丢失本次协定。
    store.save('auto', { label: `外交收口 ${store.currentDate}` })

    currentSession.value = null
    return { narrative: settle.narrative }
  }

  /** 放弃协商（不改关系，record 存 abandoned） */
  function cancelDiplomacy(): void {
    diplomacyEpoch.value++
    const session = currentSession.value
    if (!session) return

    const targetLabel = session.targetCountry
      ? countryName(session.targetCountry)
      : session.targetFaction
        ? (OWNER_LABELS[session.targetFaction] ?? session.targetFaction)
        : '?'
    session.status = 'abandoned'
    persist()
    store.save('auto', { label: `搁置外交 ${store.currentDate}` })
    currentSession.value = null
    toast.push({
      icon: 'flag',
      tone: 'neutral',
      title: '谈判搁置',
      text: `与${targetLabel}的协商被搁置`,
    })
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
