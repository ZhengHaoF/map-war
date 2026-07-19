/**
 * AI 提示词 / 上下文装配器。
 *
 * 把「给 AI 的提示词」和「本次对话要携带的世界信息」从面板里抽出来，
 * 调试工具与未来真实 agent-kernel 共用，避免两边各写一份导致漂移。
 *
 * 三个职责：
 * 1. buildSystemPrompt —— god-mode 角色 + 契约说明
 * 2. buildWorldContext —— 按需世界态：玩家基础信息 + 对话中出现的城市（本地匹配），可选注入
 * 3. buildMessages —— 组装最终 messages[]
 */

import { useGameStore } from '@/stores/game'
import { CONTRACT_SCHEMA_TEXT, PLAYER_AI_UNIFIED_PROMPT } from './aiOrderContract'

/** AI 角色类型：world = god-mode 调试（最高权限）；user = 玩家势力代理（受限）。 */
export type AiKind = 'world' | 'user'

/**
 * system prompt 选择器：
 * - world → CONTRACT_SCHEMA_TEXT（god-mode，最高权限）
 * - user  → USER_AI_SYSTEM_PROMPT（玩家势力代理，受限）
 */
export function buildSystemPrompt(kind: AiKind = 'world'): string {
  return kind === 'user' ? PLAYER_AI_UNIFIED_PROMPT : CONTRACT_SCHEMA_TEXT
}

/**
 * 玩家基础信息（名称 / 势力 / 控制的城市）。
 * 后续其他入口（如玩家统一 UI）也可单独调用。
 */
export function buildPlayerProfile(): string {
  const store = useGameStore()
  const lines: string[] = []
  lines.push(`玩家名称：${store.playerName || '（未设置）'}`)
  lines.push(`玩家势力：${store.currentFaction ?? '（未选）'}`)
  const mine = Object.values(store.cities).filter((c) => c.owner === store.currentFaction)
  lines.push(`玩家控制城市（${mine.length} 座）：`)
  for (const c of mine) {
    lines.push(`  - ${c.name}（驻军 ${c.troops}k，士气 ${c.morale}${c.fort ? `，工事等级 ${c.fort}` : ''}）`)
  }
  return lines.join('\n')
}

/**
 * 对话中出现的城市（本地匹配中文名，无 AI）。
 * 遍历城市索引，凡城市名出现在 userText 中即纳入，供 AI 知晓目标态势。
 */
export function buildMentionedCities(userText: string): string {
  const store = useGameStore()
  const mentioned = Object.values(store.cities).filter((c) => userText.includes(c.name))
  if (!mentioned.length) return ''
  const lines: string[] = ['对话涉及城市：']
  for (const c of mentioned) {
    lines.push(`  - ${c.name}：归属 ${c.owner}（驻军 ${c.troops}k，士气 ${c.morale}）`)
  }
  return lines.join('\n')
}

/**
 * 按需世界态：组合「玩家基础信息」+「对话中出现的城市」。
 * 替代原全量快照，token 大幅缩减，且城市以中文名呈现（与契约一致）。
 */
export function buildWorldContext(userText: string): string {
  return [buildPlayerProfile(), buildMentionedCities(userText)].filter(Boolean).join('\n\n')
}

export interface BuildMessagesOpts {
  userText: string
  /** 是否把按需世界态（玩家基础信息 + 对话中出现的城市）注入为一条 system 消息。默认关；开启后注入内容已精简且含中文名。 */
  injectContext?: boolean
}

/** 组装最终发给 LLM 的 messages。 */
export function buildMessages(opts: BuildMessagesOpts): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: buildSystemPrompt() },
  ]

  // 暂不注入世界态快照（默认关）：快照以 gb 码列城市，与契约「用中文名指令」不一致，
  // 且全量城市快照会显著拉长上下文、增加 token 成本。需要时由 injectContext 手动开启。
  if (opts.injectContext) {
    messages.push({ role: 'system', content: '当前世界态：\n' + buildWorldContext(opts.userText) })
  }

  messages.push({ role: 'user', content: opts.userText })
  return messages
}
