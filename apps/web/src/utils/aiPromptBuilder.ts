/**
 * AI 提示词 / 上下文装配器。
 *
 * 把「给 AI 的提示词」和「本次对话要携带的世界信息」从面板里抽出来，
 * 调试工具与未来真实 agent-kernel 共用，避免两边各写一份导致漂移。
 *
 * 三个职责：
 * 1. buildSystemPrompt —— god-mode 角色 + 契约说明
 * 2. buildPlayerProfile —— 玩家身份信息（名称 / 势力）
 * 3. buildMessages —— 组装最终 messages[]
 * 城市数据由 aiContext.ts 的 buildWorldOverview / buildFactionContext 等提供。
 */

import { useGameStore } from '@/stores/game'
import { Owner, OWNER_DETAILS, OWNER_LABELS } from '@/data/owners'
import { CONTRACT_SCHEMA_TEXT, PLAYER_AI_UNIFIED_PROMPT, ADVISOR_SYSTEM_PROMPT } from './aiOrderContract'
import { ORDER_TYPES } from './gameOrders'
import { buildWorldOverview } from './aiContext'

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
 * 玩家基本信息（名称 / 势力）。
 * 城市数据已由 worldOverview 提供，此处只保留身份信息。
 */
export function buildPlayerProfile(): string {
  const store = useGameStore()
  return `玩家名称：${store.playerName || '（未设置）'}\n玩家势力：${store.currentFaction ?? '（未选）'}`
}

/** 玩家基本信息，注入为一条 system 消息。 */
export function buildWorldContext(): string {
  return `玩家信息：\n${buildPlayerProfile()}`
}

export interface BuildMessagesOpts {
  userText: string
  /** 是否把按需世界态（玩家基础信息 + 对话中出现的城市）注入为一条 system 消息。默认关。 */
  injectContext?: boolean
  /** 是否注入世界全景（所有势力 + 全部城市，紧凑格式）。玩家 AI 操作台默认开。 */
  injectWorldOverview?: boolean
  /** 近期世界动态（来自 eventLog 的压缩时间线）。非空则注入为一条独立 system 消息。 */
  history?: string
}

/** 组装最终发给 LLM 的 messages。 */
export function buildMessages(opts: BuildMessagesOpts): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: buildSystemPrompt() },
  ]

  if (opts.injectWorldOverview) {
    messages.push({ role: 'system', content: '世界全景：\n' + buildWorldOverview() })
  }

  if (opts.injectContext) {
    messages.push({ role: 'system', content: '玩家信息：\n' + buildPlayerProfile() })
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
  城市信息格式说明
═══════════════════════════════════════

上下文中的城市信息使用紧凑格式，每行一个城市：
  城名 驻军Xk 士气X 地形 L城级 工事X

字段含义：
- 驻军：单位千（k），如 8k = 8000 人
- 士气：0-100，越高战斗力越强
- 地形：山地/丘陵/平原/林地——影响攻防
- L城级：城市等级 1-5，越高战略价值越大
- 工事：工事等级，越高城防越强

邻接城市额外带势力标记（如"KMT控"），表示该城当前归属。

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
