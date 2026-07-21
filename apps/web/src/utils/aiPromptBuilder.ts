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
import { Owner, OWNER_DETAILS, OWNER_LABELS } from '@/data/owners'
import { CONTRACT_SCHEMA_TEXT, PLAYER_AI_UNIFIED_PROMPT, ADVISOR_SYSTEM_PROMPT } from './aiOrderContract'
import { ORDER_TYPES } from './gameOrders'

/** AI 角色类型：world = god-mode 调试（最高权限）；user = 玩家势力代理（受限）；advisor = 战略顾问（场外援助）。 */
export type AiKind = 'world' | 'user' | 'advisor'

/**
 * system prompt 选择器：
 * - world → CONTRACT_SCHEMA_TEXT（god-mode，最高权限）
 * - user  → PLAYER_AI_UNIFIED_PROMPT（玩家势力代理，受限）
 * - advisor → ADVISOR_SYSTEM_PROMPT（战略顾问，场外援助）
 */
export function buildSystemPrompt(kind: AiKind = 'world'): string {
  switch (kind) {
    case 'user':
      return PLAYER_AI_UNIFIED_PROMPT
    case 'advisor':
      return ADVISOR_SYSTEM_PROMPT
    default:
      return CONTRACT_SCHEMA_TEXT
  }
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
    lines.push(`  - ${c.name}：归属 ${OWNER_LABELS[c.owner] ?? c.owner}（驻军 ${c.troops}k，士气 ${c.morale}）`)
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
  /** 近期世界动态（来自 eventLog 的压缩时间线）。非空则注入为一条独立 system 消息，位于世界态之后、user 之前。 */
  history?: string
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

  if (opts.history && opts.history.trim()) {
    messages.push({ role: 'system', content: '近期世界动态：\n' + opts.history })
  }

  messages.push({ role: 'user', content: opts.userText })
  return messages
}

/**
 * 为指定政权构建专属 AI system prompt（P2/P3 政权AI决策用）。
 *
 * 每个政权的 AI 是自主决策者——读当前世界态，产出自身本回合的操作。
 * 约束：actor 必为自身；禁 setCurrentDate / setFactionAlive / setCurrentFaction；
 *       「无动作」为合法回复（返回空 orders 列表）。
 */
export function buildFactionSystemPrompt(faction: Owner): string {
  const detail = OWNER_DETAILS[faction]
  const label = OWNER_LABELS[faction] ?? faction
  const factionInfo = detail
    ? `\n你代表「${label}」（${detail.fullName}），都城 ${detail.capital}，领导人 ${detail.leader}。${detail.strength}。${detail.description}\n`
    : `\n你代表「${label}」。\n`

  // 构建可用指令列表（排除系统管理指令）
  const usableOrders = ORDER_TYPES.filter(
    (t) => t !== 'setCurrentDate' && t !== 'setFactionAlive' && t !== 'setCurrentFaction',
  )

  return `你是民国军阀推演游戏中「${label}」的 AI 决策者。${factionInfo}
═══════════════════════════════════════
  核心职责
═══════════════════════════════════════

你是自主决策的势力领袖。每回合你会收到当前世界态，然后独立决定：
1. 本回合是否采取行动（攻击、调兵、占领……）
2. 如果需要行动，产出结构化指令列表

═══════════════════════════════════════
  决策约束
═══════════════════════════════════════

- actor 必须是你自己（${faction}）；你只能指挥自己的军队和城市
- 严禁使用 setFactionAlive / setCurrentFaction / setCurrentDate（系统管理）
- from 必须是你自己的城市；capture 必须是你攻下的城市
- 所有地点用城市中文名
- 「无动作」是完全合法的回复——如果局势不需要行动，返回空 orders 即可

═══════════════════════════════════════
  输出格式（必须严格遵守）
═══════════════════════════════════════

你必须只返回一个 JSON 对象：

{
  "msg": "一句叙事总结（如'晋军自太原南下，窥伺洛阳'或'东北军按兵不动，静观其变'）",
  "orders": [
    { "order": "battle", "from": "太原", "to": "洛阳" },
    { "order": "moveTroops", "from": "大同", "to": "太原", "amount": 10 }
  ]
}

注意：
- 如果本回合无行动，orders 为空数组 []
- msg 必须是一句自然中文叙事

═══════════════════════════════════════
  可用指令
═══════════════════════════════════════

${usableOrders.join(' / ')}
- battle: from(己方城) to(目标城) — 发起攻城战
- capture: gb(城名) owner(${OWNER_LABELS[faction]}) [resultTroops: 占领后驻军千]
- moveTroops: from(己方源城) to(己方目标城) amount(正数,千) — 调兵
- arrowFly / radarPulse / orbBurst / fogCover — 纯视觉（一般不用）
- stopBattle / stopBattles / listBattles — 战斗管理（一般不用）

所有战斗结果由世界 AI 裁定，你只需发布进攻/调兵意图。`
}
