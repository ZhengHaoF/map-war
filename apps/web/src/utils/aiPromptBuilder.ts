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
  const faction = store.currentFaction
  const factionLabel = faction ? (OWNER_LABELS[faction] ?? faction) : undefined
  return `玩家名称：${store.playerName || '（未设置）'}\n玩家势力：${factionLabel ? `${factionLabel}（${faction}）` : '（未选）'}`
}

/** 玩家基本信息，当前未使用；保留供未来调度器引用。 */

export interface BuildMessagesOpts {
  userText: string
  /** 是否把按需世界态（玩家基础信息 + 对话中出现的城市）注入为一条 system 消息。默认关。 */
  injectContext?: boolean
  /** 是否注入世界全景（所有势力 + 全部城市，紧凑格式）。玩家 AI 操作台默认开。 */
  injectWorldOverview?: boolean
  /** 近期世界动态（来自 eventLog 的压缩时间线）。非空则注入为一条独立 system 消息。 */
  history?: string
  /** 最近 N 轮的 user/assistant 对话（仅 user 模式）。每条生成一对消息，插在 system 消息后、当前 user 前。 */
  chatTurns?: { userText: string; assistantText: string }[]
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

  if (opts.chatTurns?.length) {
    for (const turn of opts.chatTurns) {
      messages.push({ role: 'user', content: turn.userText })
      messages.push({ role: 'assistant', content: turn.assistantText })
    }
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
1. 本回合是否采取行动（攻击、调兵、占领、增援、撤退……）
2. 如果需要行动，产出结构化指令列表

═══════════════════════════════════════
  决策约束
═══════════════════════════════════════

- actor 必须是你自己（${faction}）；你只���指挥自己的军队和城市
- 严禁使用 setFactionAlive / setCurrentFaction / setCurrentDate（系统管理）
- from 必须是你自己的城市；capture 必须是你攻下的城市
- 所有地点用城市中文名
- 「无动作」是完全合法的回复——如果局势不需要行动，返回空 orders 即可

═══════════════════════════════════════
  城市信息格式说明
═══════════════════════════════════════

上下文中的城市信息使用紧凑格式，每行一个城市：
  城名 驻军Xk 士气X [地形] [L城级] [工事X]

如果有「外Yk」标记（如 驻3k/外12k），表示该城派出了Y千人外出作战，城内只剩X千。
（城市工业/粮食/工事数值范围均为 0-100，增量建议 5-20 为正常范围）

邻接城市额外带势力标记（如"KMT控"），表示该城当前归属。

═══════════════════════════════════════
  战斗机制说明
═══════════════════════════════════════

1. 开战前先 deploy（出兵）：调拨驻军为外出兵力，人离开城市
   例：deploy from:"奉天" amount:12 → 奉天 驻15k/外0k → 驻3k/外12k
2. 然后 battle 发起攻城（可带 deployAmount，一步到位）
3. 每回合自动结算战斗损耗（你无需手动下 attack 指令）
4. 战斗默认延续：不发 stopBattle 就继续打，下回合再结算一轮
5. 撤退走 stopBattle(reason:"retreat")，外出兵力转回驻军

⚠ 派兵出征后城内防御变弱——慎防第三方趁虚而入！

═══════════════════════════════════════
  输出格式（必须严格遵守）
═══════════════════════════════════════

你必须只返回一个 JSON 对象：

{
  "msg": "一句叙事总结（如'晋军从太原出发，逼近洛阳'或'东北军按兵不动，静观其变'）",
  "orders": [
    { "order": "deploy", "from": "奉天", "amount": 12 },
    { "order": "battle", "from": "奉天", "to": "锦州" },
    { "order": "reinforce", "gb": "奉天", "amount": 5, "side": "attacker" }
  ],
  "telegram": "（可选）给玩家的一封电报"
}

注意：
- 如果本回合无行动，orders 为空数组 []
- deploy 和 battle 可合并：battle 带 deployAmount 字段即可
- reinforce：attacker=增援前线（加外出兵力），defender=增援守城（加驻军）
- msg 必须是一句自然中文叙事
- telegram 可选，50-80字半文言

═══════════════════════════════════════
  可用指令
═══════════════════════════════════════

${usableOrders.join(' / ')}
- deploy: from(己方城) amount(正数,千) — 出兵，驻军→外出兵力
- battle: from(己方城) to(目标城) [deployAmount] — 发起攻城战
- reinforce: gb(城名) amount(正数,千) side(attacker/defender) — 增援前线或守城
- capture: gb(城名) owner(${OWNER_LABELS[faction]}) [resultTroops] — 占领
- moveTroops: from(己方源城) to(己方目标城) amount(正数,千) — 调兵
- stopBattle: id(战斗id) [reason:retreat/surrender] — 终止战斗
- recruit / develop / fortify / rally — 内政建设
- arrowFly / radarPulse / orbBurst / fogCover — 纯视觉演出

有进行中的战斗：可选 reinforce 增援、stopBattle 撤退、或不下指令继续打。`
}

/**
 * P4a 战斗裁决 AI 的 system prompt。
 * 输入紧凑战斗摘要，输出每场损耗裁定。
 */
export function buildBattleSettlePrompt(): string {
  return `你是民国军阀推演游戏中的"战斗裁决官"。

═══════════════════════════════════════
  职责
═══════════════════════════════════════

你会收到进行中的战斗列表（紧凑格式），逐场裁定本轮双方的损耗。

═══════════════════════════════════════
  裁定参考（非硬约束，在此区间内自由发挥）
═══════════════════════════════════════

- 攻守兵力相当（比 0.8-1.2）→ 双方各损 8-15%
- 攻方 2:1 优势 → 攻损 3-8%，守损 10-20%
- 攻方 3:1 以上优势 → 攻损 2-5%，守损 15-30%
- 守方工事 fort >= 50 → 攻损额外 +20-40%
- 守方士气 < 30 → 守损额外 +30-50%
- 地形（仅作参考）：山地守方+50% / 丘陵+20% / 城市+40% / 平原林地无修正

═══════════════════════════════════════
  战斗摘要格式（每场一行）
═══════════════════════════════════════

battle_X ATTACKER(城名/外出Xk/士气X) vs DEFENDER(城名/驻军Xk/士气X) fort=X terrain=X turns=X lastTurn: X损X/X损X trend=X

═══════════════════════════════════════
  输出格式
═══════════════════════════════════════

必须只返回一个 JSON 对象：
{
  "resolutions": [
    {
      "battleId": "battle_1",
      "attackerLoss": 400,
      "defenderLoss": 350,
      "narrative": "奉天前线激烈交火，东北军据城固守，双方各有损耗"
    }
  ]
}

注意：
- 每场战斗必须对应一条，不能遗漏
- attackerLoss/defenderLoss 是千（k），正整数
- narrative 可选，一句话描述本轮战况
- 如果攻方 fieldForce <= 守方 20%，可让攻损偏大、守损偏小（强弩之末），但不要直接判负——终止条件由系统检查`
}

/**
 * 构建战斗上下文，注入到 P3 势力 AI 的 user message 中。
 * 列出该势力参与的所有 ACTIVE 战斗的当前状态。
 */
export function buildBattleContext(faction: Owner): string {
  const store = useGameStore()
  const myBattles = store.myBattles
  if (!myBattles.length) return ''

  const lines: string[] = [`你当前有 ${myBattles.length} 场进行中的战斗：`]
  for (const b of myBattles) {
    const from = (store.cities as unknown as Record<string, { name: string; troops: number; fieldForce: number; morale: number }>)[b.from]
    const to = (store.cities as unknown as Record<string, { name: string; troops: number; fieldForce: number; morale: number; fort: number }>)[b.to]
    const isAttacker = b.attacker === faction
    if (isAttacker) {
      lines.push(
        `  [攻方] ${b.id}: ${b.fromName}→${b.toName} | 我方外出${from?.fieldForce ?? 0}k/士气${from?.morale ?? 0} vs 守方驻军${to?.troops ?? 0}k/士气${to?.morale ?? 0} | 已打${b.turns}回合 累计攻损${b.totalAttackerLoss}k/守损${b.totalDefenderLoss}k`,
      )
    } else {
      lines.push(
        `  [守方] ${b.id}: ${b.fromName}→${b.toName} | 攻方外出${from?.fieldForce ?? 0}k vs 我方驻军${to?.troops ?? 0}k/士气${to?.morale ?? 0} 工事${to?.fort ?? 0} | 已打${b.turns}回合 累计攻损${b.totalAttackerLoss}k/守损${b.totalDefenderLoss}k`,
      )
    }
  }
  lines.push('')
  lines.push('你可选择：reinforce 增援 / stopBattle 撤退 / 不下指令继续打。')
  return lines.join('\n')
}

/**
 * 构建 P4a 战斗裁决 AI 的 user message（所有 ACTIVE 战斗的紧凑摘要）。
 */
export function buildBattleSummary(): string {
  const store = useGameStore()
  const active = store.battles.filter((b) => b.active)
  if (!active.length) return ''

  const lines: string[] = [`共 ${active.length} 场进行中的战斗：`]
  for (const b of active) {
    const from = (store.cities as unknown as Record<string, { name: string; troops: number; fieldForce: number; morale: number }>)[b.from]
    const to = (store.cities as unknown as Record<string, { name: string; troops: number; fieldForce: number; morale: number; fort: number; terrain: string }>)[b.to]
    const trend = b.totalAttackerLoss > b.totalDefenderLoss * 1.2 ? '守方占优' : b.totalDefenderLoss > b.totalAttackerLoss * 1.2 ? '攻方占优' : '僵持'
    const last = b.turns > 0 && b.lastAttackerLoss > 0
      ? ` lastTurn: 攻损${b.lastAttackerLoss}k/守损${b.lastDefenderLoss}k`
      : ''
    lines.push(
      `${b.id} ${b.attacker}(${b.fromName}/外出${from?.fieldForce ?? 0}k/士气${from?.morale ?? 0}) vs ${b.defender}(${b.toName}/驻军${to?.troops ?? 0}k/士气${to?.morale ?? 0}) fort=${to?.fort ?? 0} terrain=${to?.terrain ?? '平原'} turns=${b.turns}${last} trend=${trend}`,
    )
  }
  return lines.join('\n')
}
