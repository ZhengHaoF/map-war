/**
 * AI 决策公共包装 —— 统一「调 LLM → 解析 payloads → unwrapData → 结构校验」流程。
 *
 * 取代 useAgentKernel 内 3 处 invoke 函数（invokeFactionAI / invokeWorldAIBatch /
 * invokeWorldAISettle）的重复代码，#5.2 改动。
 *
 * 设计：
 * - 调 callLlm（重试策略集中在 useLlmClient）
 * - 解析失败不重试（重试 AI 同 prompt 大概率同结果，浪费 token）
 * - 战略校验不在此处（玩家/政权校验规则差异大，由调用方做）
 * - useAiOrchestrator 暂不接入（user 模式 results[] 结构不同，保留独立解析路径；待后续迁移）
 */
import { callLlm, type LlmCallOpts } from '@/composables/useLlmClient'
import { extractPayloads, unwrapData } from '@/utils/aiParse'
import { validateOrders, type BatchValidation } from '@/utils/aiOrderContract'
import { OWNER_LABELS } from '@/data/owners'
import { buildPlayerProfile } from '@/utils/aiPromptBuilder'

/** 势力代号对照表（注入 prompt，让 AI 直接返回代号而非中文名） */
const FACTION_CODES = Object.entries(OWNER_LABELS)
  .filter(([k]) => k !== 'NEUTRAL')
  .map(([code, label]) => `${code}=${label}`)
  .join(', ')

export interface InvokeAgentDecisionOpts {
  systemPrompt: string
  userContext: string
  /** 透传给 callLlm 的额外选项（model / responseFormat / maxRetries） */
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

export interface InvokeAgentDecisionResult {
  /** 通过结构校验的指令（结构错的仍在 orders 数组中，errors[i] 标记） */
  orders: BatchValidation['orders']
  /** 与 orders 等长；空数组 = 该项通过结构校验 */
  errors: BatchValidation['errors']
  /** 是否全部通过（结构校验层） */
  allOk: boolean
  /** LLM 原始回包（用于调试 / 错误排查） */
  raw: unknown
  /** 解析是否成功（payloads 数组非空 + 至少一个 unwrapData 成功） */
  parseSucceeded: boolean
}

/**
 * 调 LLM + 解析 + 结构校验。返回结构化结果供调用方做战略校验 / 入队。
 */
export async function invokeAgentDecision(opts: InvokeAgentDecisionOpts): Promise<InvokeAgentDecisionResult> {
  const raw = await callLlm({
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userContext },
    ],
    ...(opts.llmOpts ?? {}),
  })
  const payloads = extractPayloads(raw)
  if (!payloads.length) {
    return {
      orders: [],
      errors: [],
      allOk: false,
      raw,
      parseSucceeded: false,
    }
  }
  // 合并多 payload：每条单独校验
  const allOrders = []
  const allErrors: string[][] = []
  let allOk = true
  for (const p of payloads) {
    const unwrapped = unwrapData(p)
    const batch = validateOrders(unwrapped)
    for (let i = 0; i < batch.orders.length; i++) {
      allOrders.push(batch.orders[i])
      allErrors.push(batch.errors[i] ?? [])
      if (batch.errors[i]?.length) allOk = false
    }
  }
  return {
    orders: allOrders,
    errors: allErrors,
    allOk,
    raw,
    parseSucceeded: true,
  }
}

// ── 电报即时回信（统一 JSON 数组格式，兼容私信 / 世界公屏多人回应）──

/** 电报回信条目（统一格式） */
export interface TelegramReplyItem {
  /** 发言者名（如"张学良"，可以是领袖、将领或幕僚） */
  name: string
  /** 势力标签（如"奉系"） */
  faction: string
  /** 电报正文 */
  content: string
}

export interface TelegramReplyOpts {
  /** 回信势力代表名（direct 模式必填，可以是领袖、将领或幕僚） */
  factionName: string
  /** 势力标签（如"国民政府"） */
  factionTag: string
  /** 势力代号（如 KMT），从 factionTag 自动查找 */
  factionCode?: string
  /** 性格关键词（如"暴烈"） */
  personality: string
  /** 当前局势一句话 */
  situation: string
  /** 近期对话历史（最近 4-6 条，按时间序） */
  recentChat: { from: 'player' | 'faction'; text: string; name?: string }[]
  /** 玩家刚发的消息 */
  playerMessage: string
  /** 'direct' = 单势力私信回信（1条）; 'world' = 世界公屏多人回应（1-3条） */
  mode?: 'direct' | 'world'
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

/**
 * 调 LLM 生成电报回信。统一返回 JSON 数组 [{name, faction, content}]。
 * - direct 模式：1 条回信
 * - world 模式：1-3 个势力各自回应
 * 失败时返回兜底文本条目。
 */
export async function invokeTelegramReply(opts: TelegramReplyOpts): Promise<TelegramReplyItem[]> {
  const mode = opts.mode ?? 'direct'
  const fallback: TelegramReplyItem = {
    name: opts.factionName || '???',
    faction: opts.factionTag || '???',
    content: '（线路故障，电报未能送达）',
  }

  const history = opts.recentChat
    .map((m) => `${m.from === 'player' ? '玩家' : (m.name || opts.factionName || '对方')}："${m.text}"`)
    .join('\n')

  let systemPrompt: string
  const code = opts.factionCode ?? ''
  const playerIdentity = buildPlayerProfile()
  if (mode === 'direct') {
    systemPrompt = `你是「${opts.factionTag}」的${opts.factionName}，性格${opts.personality}。
当前局势：${opts.situation}。
${playerIdentity}
你正和该玩家通过电报对话。以你的身份与性格回一句话（50-80字），半文言，可以引典故、放狠话、冷嘲热讽。

必须返回 JSON 数组（只含一条）：
[{"name": "${opts.factionName}", "faction": "${code}", "content": "你的回复内容"}]`
  } else {
    systemPrompt = `你是民国军阀推演游戏的电报系统。玩家向天下喊话，1-3个势力听到后各自回应。
${opts.situation}
${playerIdentity}
每个势力的回应要符合其代表人物的性格，20-60字，半文言，性格鲜明。回应者可以是领袖、将领或幕僚，不一定是最高领导人。

势力代号对照：${FACTION_CODES}
必须返回 JSON 数组（1-3条），每条是一个包含 name/faction/content 的独立对象：
[
  {"name": "张学良", "faction": "NEA", "content": "电文内容..."},
  {"name": "蒋中正", "faction": "KMT", "content": "电文内容..."}
]
注意：不要用平行数组格式（不要把 name、faction、content 各写成一个数组）。
挑 1-3 个最有戏的势力即可。`
  }

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]
  if (history) {
    messages.push({ role: 'user', content: `近期对话：\n${history}` })
  }
  messages.push({ role: 'user', content: `玩家最新发言：「${opts.playerMessage}」` })

  try {
    const raw = await callLlm({
      messages,
      ...(opts.llmOpts ?? {}),
    })
    // 正确提取 API 响应中的 content → 解析 JSON
    const payloads = extractPayloads(raw)
    const obj = payloads[0]
    let items: TelegramReplyItem[] = []
    if (Array.isArray(obj)) {
      items = obj as TelegramReplyItem[]
    } else if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>
      // 优先匹配已知键名
      if (Array.isArray(o.data)) items = o.data as TelegramReplyItem[]
      else if (Array.isArray(o.replies)) items = o.replies as TelegramReplyItem[]
      else if (Array.isArray(o.responses)) items = o.responses as TelegramReplyItem[]
      else if (typeof o.content === 'string') items = [obj as TelegramReplyItem]
      // 兜底：对象里随便找个数组
      if (!items.length) {
        for (const val of Object.values(o)) {
          if (Array.isArray(val) && val.length) {
            items = val as TelegramReplyItem[]
            break
          }
        }
      }
    }
    items = items.filter((it) => it && typeof it.content === 'string' && it.content.trim())
    return items.length ? items : [{ ...fallback, content: '……' }]
  } catch {
    return [fallback]
  }
}
