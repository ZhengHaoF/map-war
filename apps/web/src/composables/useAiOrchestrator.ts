/**
 * 调试 AI 编排 composable。
 *
 * 把「组装提示词 → 调 LLM → 解析回包 → 结构校验 → 执行 gameOrders」串成一条线，
 * 让 AiDebugPanel.vue 只当薄视图。
 *
 * 关键语义（来自 grill 结论）：
 * - 调试 AI = god-mode，校验只查结构、不查战略合法性。
 * - 实时改图 + store；指令执行均带 PixiJS 演出动画。
 */

import { ref, computed } from 'vue'
import { useAiChat } from './useAiChat'
import { useGameStore } from '@/stores/game'
import { executeOrder, resetBattleRuntime } from '@/utils/gameOrders'
import { freeEffectToOrder } from '@/utils/freeActionRules'
import { executeBoundedFreeEffect } from '@/utils/freeActionExecution'
import { buildMessages, buildSystemPrompt, type AiKind } from '@/utils/aiPromptBuilder'
import { buildEventHistory } from '@/utils/aiHistory'
import {
  validateOrders,
  validatePlayerOrders,
  validatePlayerOrder,
  type BatchValidation,
  type WorldValidationResult,
  type WorldValidationItem,
  type WarVerdict,
} from '@/utils/aiOrderContract'
import { normalizeCommsFrom } from '@/utils/commsEntity'
import {
  extractJson,
  extractPayloads,
  extractAiMessage,
  isUnifiedResult,
  isFreeActionResult,
  unwrapData,
  type FreeActionResult,
  type FreeActionPayload,
} from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'
import { sendTelegram } from '@/utils/ai'
import { Owner, OWNER_DETAILS, OWNER_LABELS } from '@/data/owners'
import { useToast } from '@/composables/useToast'
import { FACTION_AI_TELEGRAM_WINDOW, FREE_ACTION_EFFECT_LIMIT, ACTION_POINTS_PER_TURN } from '@/data/gameConfig'

export interface ExecResult {
  order: GameOrder
  valid: boolean
  errors: string[]
  result?: { ok: boolean; reason?: string } & Record<string, unknown>
  detail?: string
}

/** 统一 AI 响应的 results 条目 */
interface UnifiedResultItem {
  order: Record<string, unknown>
  verdict: WarVerdict
  reason: string
  suggestion?: string | null
}

/** user 模式的 AI 回复格式 */
interface UnifiedAiResponse {
  msg?: string | null
  results: UnifiedResultItem[]
}

export type AiMode = AiKind

export function useAiOrchestrator(mode: AiMode = 'world') {
  const store = useGameStore()
  const { loading, error, response, send } = useAiChat()

  // 用户模式（玩家势力代理）默认注入按需世界态（玩家城 + 对话城），
  // 以便 AI 在「进攻杭州」缺省 from 时挑最近己方城市；god-mode 仍默认关、可手动开。
  const systemPrompt = ref(buildSystemPrompt(mode))
  const userMessage = ref('')
  const injectContext = ref(mode === 'user' || mode === 'advisor')
  // 历史注入：玩家模式���认开（AI 操作台始终带记忆），god-mode 默认关（调试时手动开）。
  const injectHistory = ref(mode === 'user' || mode === 'advisor')
  const parsed = ref<BatchValidation | null>(null)
  const parseError = ref<string | null>(null)
  const aiMessage = ref<string | null>(null)
  const execResults = ref<ExecResult[]>([])
  // 顾问模式专属：存储完整顾问响应
  const advisorResponse = ref<{ reply?: string; suggestions?: string[] } | null>(null)
  // 玩家模式专属：存储 AI 返回的后续行动建议
  const playerSuggestions = ref<string[] | null>(null)

  // 多轮对话：最近 N 轮的 user/assistant 对（仅 user 模式，由调用方在 runSend 前设置）
  const chatTurns = ref<{ userText: string; assistantText: string }[]>([])

  // ── 玩家模式专属：战略校验状态 ──
  /** 硬编码规则拒绝的指令（同步，runSend 后立即可用） */
  const strategicRejected = ref<{ order: GameOrder; reason: string }[]>([])
  /** AI 一次调用产出的可行性判断（从 results 中提取） */
  const worldValidation = ref<WorldValidationResult | null>(null)
  /** 自由行动管道：AI 判定为非指令类行动时，存储叙事 + 事件列表 */
  const freeActionResult = ref<FreeActionPayload | null>(null)

  /**
   * 硬编码战略规则拦截（同步，零 LLM 成本）。
   * 在结构校验通过后调用；对 user 模式自动生效，world 模式跳过。
   */
  function applyStrategicRules(): void {
    strategicRejected.value = []
    const p = parsed.value
    if (mode !== 'user' || !p) return

    const store = useGameStore()
    // 只对结构校验通过的指令做战略校验
    const structureOk = p.orders.filter((_, i) => !p.errors[i].length)
    const result = validatePlayerOrders(
      structureOk,
      store.currentFaction,
      (gb) => store.ownership[gb],
      (gb) => store.cities[gb]?.troops,
    )
    strategicRejected.value = result.rejected
  }

  /**
   * 获取「待世界AI校验」的指令列表（结构通过 + 硬编码规则通过）。
   */
  function getPendingOrders(): GameOrder[] {
    const p = parsed.value
    if (!p) return []
    const structureOk = p.orders.filter((_, i) => !p.errors[i].length)
    if (mode !== 'user') return structureOk
    const rejectedGbs = new Set(strategicRejected.value.map((r) => r.order))
    return structureOk.filter((o) => !rejectedGbs.has(o))
  }

  /**
   * 获取最终可执行的指令列表（结构校验 → 硬编码规则 → 世界AI校验 三道关全部通过）。
   * PlayerAiPanel 应使用此函数而非手动过滤。
   */
  function getFinalApprovedOrders(): GameOrder[] {
    const pending = getPendingOrders()
    if (mode !== 'user' || !worldValidation.value) return pending

    // 世界AI校验：仅 feasible 通过（impossible 拦截）
    const feasibleIndices = new Set(
      worldValidation.value.validations
        .filter((v) => v.verdict === 'feasible')
        .map((v) => v.index),
    )
    return pending.filter(order => feasibleIndices.has(parsed.value!.orders.indexOf(order)))
  }

  /** 世界AI断定为不可能的指令 + 理由 + 建议（供 UI 琥珀色警告） */
  const worldImpossible = computed(() => {
    if (!worldValidation.value) return []
    return worldValidation.value.validations
      .filter((v) => v.verdict === 'impossible')
      .map((v) => ({
        order: parsed.value?.orders[v.index],
        reason: v.reason || '世界AI未说明原因',
        suggestion: v.suggestion || undefined,
      }))
  })

  async function runSend() {
    if (!userMessage.value.trim()) return
    parsed.value = null
    parseError.value = null
    aiMessage.value = null
    worldValidation.value = null
    freeActionResult.value = null
    playerSuggestions.value = null
    execResults.value = []

    // 本轮历史取「此前」的 eventLog（当前回合尚未落 narrative），不含自己。
    const history = injectHistory.value ? buildEventHistory({ mode: 'recent' }) : ''
    const messages = buildMessages({
      userText: userMessage.value,
      injectContext: injectContext.value,
      injectWorldOverview: mode === 'user' || mode === 'advisor',
      history,
      chatTurns: chatTurns.value.length > 0 ? chatTurns.value : undefined,
    })
    // 允许开发者覆盖自动生成的 system prompt
    if (systemPrompt.value.trim()) {
      messages[0] = { role: 'system', content: systemPrompt.value }
    }
    if (mode === 'user' && store.currentFaction) {
      messages.splice(messages.length - 1, 0, { role: 'system', content:
        `本方本回合剩余行动额度 ${store.getActionPoints(store.currentFaction)}/${ACTION_POINTS_PER_TURN}。征兵/建设/整军/部署/调兵/开战每条1点，撤退和查询不耗点。自由效果每条1点，每次最多${FREE_ACTION_EFFECT_LIMIT}条；同一敌城宣传/破坏本回合仅一次且耗10万银，本方筹银和筹粮各仅一次且至多50。日期和占领由系统自动结算；结盟/停战须双方外交协商。不要生成capture或setCurrentDate，也不要声称未执行的效果已经发生。`,
      })
    }

    await send({ messages, response_format: { type: 'json_object' } })

    const raw = response.value
    const payloads = extractPayloads(raw)
    if (!payloads.length) {
      parseError.value = 'AI 回复中未找到可解析的 JSON（content 或 tool_calls 均无）。'
      return
    }
    const merged = payloads.length === 1 ? payloads[0] : payloads

    // ── advisor 模式：{reply: string, suggestions: string[]} ──
    if (mode === 'advisor') {
      const response = merged as { reply?: string; suggestions?: string[] }
      if (typeof response?.reply === 'string') {
        aiMessage.value = response.reply
        advisorResponse.value = response
        // 顾问模式不写入 eventLog，只存储在本地
      } else {
        parseError.value = '顾问AI回复格式错误：缺少 reply 字段'
      }
      return
    }

    // ── user 模式：自由行动 {msg, freeAction: {narrative, success, effects[]}} ──
    if (mode === 'user' && isFreeActionResult(merged)) {
      const fa = merged as FreeActionResult
      aiMessage.value = fa.msg ?? fa.freeAction.narrative
      freeActionResult.value = fa.freeAction
      // 落 narrative 到 eventLog
      if (aiMessage.value) {
        store.applyEvent({
          type: 'narrative',
          playerInput: userMessage.value.trim(),
          aiMessage: aiMessage.value,
          kind: 'player',
        })
      }
      // 成功则立即执行事件（失败则只叙事，不改世界态）
      if (fa.freeAction.success && fa.freeAction.effects.length) {
        await runExecuteFreeAction(fa.freeAction)
      }
      return
    }

    // ── user 模式：统一格式 {msg, results: [{order, verdict, reason, suggestion}], suggestions?: string[]} ──
    if (mode === 'user' && isUnifiedResult(merged)) {
      const unified = merged as UnifiedAiResponse & { suggestions?: string[] }
      aiMessage.value = unified.msg ?? null
      // 落 narrative 到 eventLog（玩家模式），使对话历史经 eventLog 持久化、被后续回合读取。
      // 唯一落库点：视图层（PlayerAiPanel）不再重复写，避免历史被记两次。
      // kind='player' 标记为玩家对话记录（旧版默认行为，aiHistory.eventLine 渲染为"玩家：…→ AI：…"）
      if (aiMessage.value) {
        store.applyEvent({
          type: 'narrative',
          playerInput: userMessage.value.trim(),
          aiMessage: aiMessage.value,
          kind: 'player',
        })
      }

      // 从 results 提取 orders 做结构校验
      const orders = unified.results.map((r) => r.order)
      parsed.value = validateOrders(orders)

      // 构建 WorldValidationResult（index = 数组位置，summary 自动生成）
      const validations: WorldValidationItem[] = unified.results.map((r, i) => ({
        index: i,
        verdict: r.verdict,
        reason: r.reason || '',
        suggestion: r.suggestion ?? undefined,
      }))
      const counts = { feasible: 0, impossible: 0 }
      for (const v of validations) {
        if (v.verdict === 'feasible') counts.feasible++
        else counts.impossible++
      }
      const summary = `${counts.feasible} 条可行，${counts.impossible} 条不可行`
      worldValidation.value = { validations, summary }

      // 提取后续行动建议（可选字段）
      if (Array.isArray(unified.suggestions) && unified.suggestions.length > 0) {
        playerSuggestions.value = unified.suggestions.filter(
          (s) => typeof s === 'string' && s.trim()
        )
      }
      return
    }

    // ── world 模式兼容旧格式 {orders:[...], msg} ──
    parsed.value = validateOrders(unwrapData(merged))
    aiMessage.value = extractAiMessage(merged)
    // 仅玩家模式落 narrative（god-mode 调试不污染事件日志）；唯一落库点，视图层不再重复写。
    if (mode === 'user' && aiMessage.value) {
      store.applyEvent({
        type: 'narrative',
        playerInput: userMessage.value.trim(),
        aiMessage: aiMessage.value,
        kind: 'player',
      })
    }
  }

  /**
   * 自由行动管道：遍历 effects，资源类走指令管线、其余直通钳制后 applyEvent。
   *
   * ① 资源类（produce / moveTroops / 正向内政 / 正向士气）：由 freeEffectToOrder 翻译成
   *    正规指令，经 validatePlayerOrder（归属/驻军上限）与 executeOrder（成本/动画/toast）执行——
   *    征兵扣银粮、调兵扣行军费、建设/整军扣银，杜绝“话术白嫖”。
   * ② 直通类（电报/外交/银粮叙事/负向士气/负向城市破坏）：仅安全类型，数值经 FREE_CAP_* 钳制。
   */
  async function runExecuteFreeAction(payload: FreeActionPayload): Promise<void> {
    const playerFaction = store.currentFaction
    const ownerOf = (gb: string): Owner | undefined => store.ownership[gb]
    const troopsOf = (gb: string): number | undefined => store.cities[gb]?.troops

    const applied: FreeActionPayload['effects'] = []
    const failures: string[] = []
    for (const eff of payload.effects.slice(0, FREE_ACTION_EFFECT_LIMIT)) {
      // ── ① 资源类 effect → 正规指令 ──
      // 复用 validatePlayerOrder + executeOrder：成本（征兵/行军/建设/整军）、
      // 归属（只能操作己方城）、驻军上限、动画与 toast 全部与正规指令同管线。
      const order = freeEffectToOrder(eff)
      if (order) {
        const vr = validatePlayerOrder(order, playerFaction, ownerOf, troopsOf)
        if (!vr.ok) {
          useToast().push({ icon: 'alert-triangle', tone: 'error', title: '指令失败', text: vr.reason ?? '未知原因' })
          continue
        }
        try {
          const result = await executeOrder(order)
          if (result.ok) applied.push(eff)
          else failures.push(result.reason ?? '指令未执行')
        } catch (err) {
          useToast().push({ icon: 'alert-triangle', tone: 'error', title: '指令失败', text: (err as Error).message })
        }
        continue
      }

      const outcome = executeBoundedFreeEffect(eff, payload.narrative)
      if (!outcome.ok) {
        failures.push(outcome.reason ?? '自由行动未执行')
        continue
      }
      applied.push(eff)
      // Only telegram delivery needs asynchronous handling after the bounded effect.
      if (!outcome.telegram) continue
      switch (eff.type) {
        // 发送电报：将电报存入往来记录（如求助、威胁、求和、离间等外交行动），并即时触发对方回信
        case 'sendTelegram':
          if (eff.to && eff.content) {
            const toCode = normalizeCommsFrom(eff.to)
            store.pushTelegram({
              gameDate: store.currentDate,
              from: 'PLAYER',
              to: toCode,
              content: eff.content,
              channel: 'direct',
              turn: store.turnCount,
            })
            // 即时回信：对方收到电报后立即回复（与电报面板 invokeDirectReply 同逻辑）
            try {
              const detail = OWNER_DETAILS[toCode]
              const label = OWNER_LABELS[toCode as Owner] ?? toCode
              const leader = detail?.leader ?? label
              const history = store.telegrams
                .filter((t) => t.channel === 'direct' && (t.from === toCode || t.to === toCode))
                .slice(-FACTION_AI_TELEGRAM_WINDOW)
                .map((t) => ({ from: t.from === 'PLAYER' ? 'player' as const : 'faction' as const, text: t.content }))
              const situation = `${label}，拥有${store.factionCities(toCode as Owner).length}城，兵力约${store.factionTroops(toCode as Owner)}k`
              const items = await sendTelegram({
                factionName: leader,
                factionTag: label,
                factionCode: toCode,
                personality: detail?.personality ?? '沉稳',
                situation,
                recentChat: history,
                playerMessage: eff.content,
                mode: 'direct',
              })
              if (items.length && items[0].content) {
                store.pushTelegram({
                  gameDate: store.currentDate,
                  from: toCode,
                  to: 'PLAYER',
                  content: items[0].content,
                  channel: 'direct',
                  turn: store.turnCount,
                  leaderName: items[0].name ?? leader,
                })
              }
            } catch {
              // 回信失败静默处理，不影响主流程
            }
          }
          break
        default:
          // produce / moveTroops / 正向内政 / 正向士气 / 非法字段：
          // 翻译未产出即丢弃（不直通，防止绕过成本与归属校验）
          break
      }
    }
    if (payload.effects.length > FREE_ACTION_EFFECT_LIMIT) failures.push(`每次最多执行${FREE_ACTION_EFFECT_LIMIT}项效果`)
    freeActionResult.value = {
      ...payload, effects: applied, success: applied.length > 0,
      narrative: applied.length ? `已执行 ${applied.length} 项效果。${failures.length ? `未执行：${failures.join('；')}` : payload.narrative}` : `行动未执行：${failures.join('；') || '没有有效效果'}`,
    }
    if (failures.length) useToast().push({ icon: 'alert-triangle', tone: 'error', title: '部分行动未执行', text: failures.join('；') })
  }

  async function runExecute() {
    if (!parsed.value) return
    const results: ExecResult[] = []
    for (let i = 0; i < parsed.value.orders.length; i++) {
      const order = parsed.value.orders[i]
      const errs = parsed.value.errors[i]
      if (errs.length) {
        results.push({ order, valid: false, errors: errs })
        continue
      }
      try {
        const r = await executeOrder(order, mode === 'world' ? { authority: 'debug' } : {})
        results.push({ order, valid: true, errors: [], result: r as any, detail: describe(order) })
      } catch (e) {
        results.push({
          order,
          valid: true,
          errors: [],
          result: { ok: false, reason: (e as Error).message },
          detail: '��行抛错',
        })
      }
    }
    execResults.value = results
  }

  function describe(order: GameOrder): string {
    switch (order.order) {
      case 'capture': {
        const c = store.cities[order.gb!]
        return `城市 ${order.gb} 现归属 ${c?.owner ?? '?'}（驻军 ${c?.troops ?? '?'}k）`
      }
      case 'setFactionAlive':
        return `势力 ${order.faction} 现${store.activeFactions.includes(order.faction!) ? '存活' : '已灭亡'}`
      case 'setCurrentDate':
        return `当前日期 ${store.currentDate}`
      case 'setCurrentFaction':
        return `玩家势力 ${store.currentFaction}`
      default:
        return '已下发（动画/状态见地图）'
    }
  }

  function resetWorld() {
    store.initWorld()
    resetBattleRuntime()
    execResults.value = []
    parsed.value = null
    parseError.value = null
    aiMessage.value = null
    strategicRejected.value = []
    worldValidation.value = null
    freeActionResult.value = null
  }

  return {
    // 状态
    systemPrompt,
    userMessage,
    injectContext,
    injectHistory,
    loading,
    error,
    response,
    parsed,
    parseError,
    aiMessage,
    execResults,
    // 玩家模式校验
    strategicRejected,
    worldValidation,
    worldImpossible,
    // 自由行动
    freeActionResult,
    // 顾问模式
    advisorResponse,
    // 玩家模式
    playerSuggestions,
    // 多轮对话
    chatTurns,
    // 动作
    runSend,
    runExecute,
    applyStrategicRules,
    getFinalApprovedOrders,
    resetWorld,
  }
}
