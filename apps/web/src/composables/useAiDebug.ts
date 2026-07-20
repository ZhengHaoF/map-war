/**
 * 调试 AI 编排 composable。
 *
 * 把「组装提示词 → 调 LLM → 解析回包 → 结构校验 → 执行 gameOrders」串成一条线，
 * 让 AiDebugPanel.vue 只当薄视图。
 *
 * 关键语义（来自 grill 结论）：
 * - 调试 AI = god-mode，校验只查结构、不查战略合法性。
 * - 每条指令执行前对世界态打快照，支持单步撤销。
 * - 实时改图 + store；指令执行均带 PixiJS 演出动画。
 */

import { ref, computed } from 'vue'
import { useAiChat } from './useAiChat'
import { useGameStore } from '@/stores/game'
import { executeOrder, resetBattleRuntime } from '@/utils/gameOrders'
import { buildMessages, buildSystemPrompt } from '@/utils/aiPromptBuilder'
import { buildEventHistory } from '@/utils/aiHistory'
import {
  validateOrders,
  validatePlayerOrders,
  type BatchValidation,
  type WorldValidationResult,
  type WorldValidationItem,
  type WarVerdict,
} from '@/utils/aiOrderContract'
import {
  extractJson,
  extractPayloads,
  extractAiMessage,
  isUnifiedResult,
  unwrapData,
} from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'

export interface ExecResult {
  order: GameOrder
  valid: boolean
  errors: string[]
  result?: { ok: boolean; reason?: string } & Record<string, unknown>
  detail?: string
}

type UndoFrame = ReturnType<ReturnType<typeof useGameStore>['snapshotForUndo']>

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

export type AiMode = 'world' | 'user' | 'advisor'

export function useAiDebug(mode: AiMode = 'world') {
  const store = useGameStore()
  const { loading, error, response, send } = useAiChat()

  // 用户模式（玩家势力代理）默认注入按需世界态（玩家城 + 对话城），
  // 以便 AI 在「进攻杭州」缺省 from 时挑最近己方城市；god-mode 仍默认关、可手动开。
  const systemPrompt = ref(buildSystemPrompt(mode))
  const userMessage = ref('')
  const injectContext = ref(mode === 'user')
  // 历史注入：玩家模式默认开（AI 操作台始终带记忆），god-mode 默认关（调试时手动开）。
  const injectHistory = ref(mode === 'user')
  const parsed = ref<BatchValidation | null>(null)
  const parseError = ref<string | null>(null)
  const aiMessage = ref<string | null>(null)
  const execResults = ref<ExecResult[]>([])
  const undoStack = ref<UndoFrame[]>([])
  // 顾问模式专属：存储完整顾问响应
  const advisorResponse = ref<{ reply?: string; suggestions?: string[] } | null>(null)

  // ── 玩家模式专属：战略校验状态 ──
  /** 硬编码规则拒绝的指令（同步，runSend 后立即可用） */
  const strategicRejected = ref<{ order: GameOrder; reason: string }[]>([])
  /** AI 一次调用产出的可行性判断（从 results 中提取） */
  const worldValidation = ref<WorldValidationResult | null>(null)

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
    return pending.filter((_, i) => feasibleIndices.has(i))
  }

  /** 世界AI断定为不可能的指令 + 理由 + 建议（供 UI 琥珀色警告） */
  const worldImpossible = computed(() => {
    if (!worldValidation.value) return []
    const pending = getPendingOrders()
    return worldValidation.value.validations
      .filter((v) => v.verdict === 'impossible')
      .map((v) => ({
        order: pending[v.index] ?? parsed.value?.orders[v.index],
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
    execResults.value = []

    // 本轮历史取「此前」的 eventLog（当前回合尚未落 narrative），不含自己。
    const history = injectHistory.value ? buildEventHistory({ mode: 'recent' }) : ''
    const messages = buildMessages({
      userText: userMessage.value,
      injectContext: injectContext.value,
      history,
    })
    // 允许开发者覆盖自动生成的 system prompt
    if (systemPrompt.value.trim()) {
      messages[0] = { role: 'system', content: systemPrompt.value }
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

    // ── user 模式：统一格式 {msg, results: [{order, verdict, reason, suggestion}]} ──
    if (mode === 'user' && isUnifiedResult(merged)) {
      const unified = merged as UnifiedAiResponse
      aiMessage.value = unified.msg ?? null
      // 落 narrative 到 eventLog（玩家模式），使对话历史经 eventLog 持久化、被后续回合读取。
      // 唯一落库点：视图层（PlayerAiPanel）不再重复写，避免历史被记两次。
      if (aiMessage.value) {
        store.applyEvent({ type: 'narrative', playerInput: userMessage.value.trim(), aiMessage: aiMessage.value })
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
      return
    }

    // ── world 模式兼容旧格式 {orders:[...], msg} ──
    parsed.value = validateOrders(unwrapData(merged))
    aiMessage.value = extractAiMessage(merged)
    // 仅玩家模式落 narrative（god-mode 调试不污染事件日志）；唯一落库点，视图层不再重复写。
    if (mode === 'user' && aiMessage.value) {
      store.applyEvent({ type: 'narrative', playerInput: userMessage.value.trim(), aiMessage: aiMessage.value })
    }
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
      // 执行前打快照（单步撤销）
      undoStack.value.push(store.snapshotForUndo())
      try {
        const r = await executeOrder(order)
        results.push({ order, valid: true, errors: [], result: r as any, detail: describe(order) })
      } catch (e) {
        results.push({
          order,
          valid: true,
          errors: [],
          result: { ok: false, reason: (e as Error).message },
          detail: '执行抛错',
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

  function undo() {
    const frame = undoStack.value.pop()
    if (frame) store.restoreUndo(frame)
  }

  function resetWorld() {
    store.initWorld()
    resetBattleRuntime()
    undoStack.value = []
    execResults.value = []
    parsed.value = null
    parseError.value = null
    aiMessage.value = null
    strategicRejected.value = []
    worldValidation.value = null
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
    undoStack,
    // 玩家模式校验
    strategicRejected,
    worldValidation,
    worldImpossible,
    // 顾问模式
    advisorResponse,
    // 动作
    runSend,
    runExecute,
    applyStrategicRules,
    getFinalApprovedOrders,
    undo,
    resetWorld,
  }
}
