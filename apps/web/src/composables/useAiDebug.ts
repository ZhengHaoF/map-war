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
import {
  validateOrders,
  validatePlayerOrders,
  type BatchValidation,
  type WorldValidationResult,
  type WorldValidationItem,
  type WarVerdict,
  type WarScores,
} from '@/utils/aiOrderContract'
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
  scores?: WarScores
}

/** 统一 AI 响应格式（user 模式） */
interface UnifiedAiResponse {
  msg?: string | null
  results: UnifiedResultItem[]
}

/** 判断是否为统一 results 格式（有 results 数组且无 orders 键） */
function isUnifiedResult(obj: unknown): obj is UnifiedAiResponse {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const o = obj as Record<string, unknown>
  return Array.isArray(o.results) && o.orders === undefined
}

function extractJson(text: string): unknown {
  let t = (text ?? '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fallthrough */
  }
  const start = t.search(/[[{]/)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  throw new Error('无法从 AI 回复中解析出 JSON')
}

/** 从 LLM 回包抽取待校验的 JSON（兼容 content 文本 与 tool_calls.arguments）。 */
function extractPayloads(raw: unknown): unknown[] {
  const choice = ((raw as any)?.choices ?? [])[0]
  const message = choice?.message
  const payloads: unknown[] = []

  if (typeof message?.content === 'string' && message.content.trim()) {
    try {
      payloads.push(extractJson(message.content))
    } catch {
      /* 非 JSON 文本，留给上层报错 */
    }
  }
  const toolCalls = message?.tool_calls ?? []
  for (const tc of toolCalls) {
    try {
      payloads.push(JSON.parse(tc?.function?.arguments ?? '{}'))
    } catch {
      /* 忽略坏参数 */
    }
  }
  return payloads
}

/**
 * 指令数组的顶层键（过渡期同时兼容旧 data 与新 orders）。
 * json_object 模式下 AI 只能返回对象根，指令须包在数组里。
 */
const ORDER_KEYS = ['orders', 'data'] as const

/** 从顶层对象取出指令数组（按 ORDER_KEYS 顺序命中第一个存在的）。 */
function pickOrderArray(obj: unknown): unknown[] | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  for (const k of ORDER_KEYS) {
    const v = (obj as Record<string, unknown>)[k]
    if (Array.isArray(v)) return v
  }
  return null
}

function isWrapped(obj: unknown): boolean {
  return pickOrderArray(obj) !== null
}

/** 拆掉 {orders:[...] | data:[...]} 外层，返回纯指令数组（兼容单条包裹 / 多条包裹 / 裸数组）。 */
function unwrapData(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.flatMap((p) => (isWrapped(p) ? pickOrderArray(p)! : [p]))
  }
  return isWrapped(obj) ? pickOrderArray(obj)! : obj
}

/** 从顶层对象抽取 AI 的叙事回复（msg 字段，可选）。 */
function extractAiMessage(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const m = (obj as Record<string, unknown>).msg
  return typeof m === 'string' && m.trim() ? m.trim() : null
}

export type AiMode = 'world' | 'user'

export function useAiDebug(mode: AiMode = 'world') {
  const store = useGameStore()
  const { loading, error, response, send } = useAiChat()

  // 用户模式（玩家势力代理）默认注入按需世界态（玩家城 + 对话城），
  // 以便 AI 在「进攻杭州」缺省 from 时挑最近己方城市；god-mode 仍默认关、可手动开。
  const systemPrompt = ref(buildSystemPrompt(mode))
  const userMessage = ref('')
  const injectContext = ref(mode === 'user')
  const parsed = ref<BatchValidation | null>(null)
  const parseError = ref<string | null>(null)
  const aiMessage = ref<string | null>(null)
  const execResults = ref<ExecResult[]>([])
  const undoStack = ref<UndoFrame[]>([])

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

    // 世界AI校验：仅 feasible 通过（difficult 和 impossible 均拦截，交还玩家决策）
    const feasibleIndices = new Set(
      worldValidation.value.validations
        .filter((v) => v.verdict === 'feasible')
        .map((v) => v.index),
    )
    return pending.filter((_, i) => feasibleIndices.has(i))
  }

  /** 世界AI认为困难但未完全拒绝的指令 + 理由 + 建议（供 UI 琥珀色警告） */
  const worldDifficult = computed(() => {
    if (!worldValidation.value) return []
    const pending = getPendingOrders()
    return worldValidation.value.validations
      .filter((v) => v.verdict === 'difficult')
      .map((v) => ({
        order: pending[v.index] ?? parsed.value?.orders[v.index],
        reason: v.reason || '世界AI未说明原因',
        suggestion: v.suggestion || undefined,
      }))
  })

  /** 世界AI断定为不可能的指令 + 理由 + 建议（供 UI 红色拒绝） */
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

    const messages = buildMessages({
      userText: userMessage.value,
      injectContext: injectContext.value,
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

    // ── user 模式：统一格式 {msg, results: [{order, verdict, reason, suggestion}]} ──
    if (mode === 'user' && isUnifiedResult(merged)) {
      const unified = merged as UnifiedAiResponse
      aiMessage.value = unified.msg ?? null

      // 从 results 提取 orders 做结构校验
      const orders = unified.results.map((r) => r.order)
      parsed.value = validateOrders(orders)

      // 构建 WorldValidationResult（index = 数组位置，summary 自动生成）
      const validations: WorldValidationItem[] = unified.results.map((r, i) => ({
        index: i,
        verdict: r.verdict,
        reason: r.reason || '',
        suggestion: r.suggestion ?? undefined,
        scores: r.scores,
      }))
      const counts = { feasible: 0, difficult: 0, impossible: 0 }
      for (const v of validations) counts[v.verdict]++
      const summary = `${counts.feasible} 条可行，${counts.difficult} 条困难，${counts.impossible} 条不可行`
      worldValidation.value = { validations, summary }
      return
    }

    // ── world 模式兼容旧格式 {orders:[...], msg} ──
    parsed.value = validateOrders(unwrapData(merged))
    aiMessage.value = extractAiMessage(merged)
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
    worldDifficult,
    worldImpossible,
    // 动作
    runSend,
    runExecute,
    applyStrategicRules,
    getFinalApprovedOrders,
    undo,
    resetWorld,
  }
}
