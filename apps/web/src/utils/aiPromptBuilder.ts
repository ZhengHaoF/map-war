/**
 * AI 提示词 / 上下文装配器。
 *
 * 把「给 AI 的提示词」和「本次对话要携带的世界信息」从面板里抽出来，
 * 调试工具与未来真实 agent-kernel 共用，避免两边各写一份导致漂移。
 *
 * 三个职责：
 * 1. buildSystemPrompt —— god-mode 角色 + 契约说明
 * 2. buildWorldSnapshot —— 从 store.getSnapshot() 读全局态，结构化文本（可选注入）
 * 3. buildMessages —— 组装最终 messages[]
 */

import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { CONTRACT_SCHEMA_TEXT } from './aiOrderContract'

/** system prompt：契约文案 + god-mode 角色说明。 */
export function buildSystemPrompt(): string {
  return CONTRACT_SCHEMA_TEXT
}

/**
 * 全局世界态快照（god-mode 视角，全棋盘）。
 * 复用 store.getSnapshot()（非响应式拷贝，安全序列化给 LLM）。
 */
export function buildWorldSnapshot(): string {
  const store = useGameStore()
  const snap = store.getSnapshot()
  const lines: string[] = []

  lines.push(`当前推演日期：${snap.currentDate}`)
  lines.push(`玩家所选势力：${snap.currentFaction ?? '（未选）'}`)

  lines.push('\n势力存活：')
  for (const f of Object.values(Owner)) {
    const alive = snap.activeFactions.includes(f)
    const troops = snap.factionTroops[f] ?? 0
    lines.push(`  - ${f}（${OWNER_LABELS[f] ?? f}）：${alive ? '存活' : '已灭亡'}，总兵力 ${troops}k`)
  }

  lines.push('\n城市归属（全部）：')
  const entries = Object.entries(snap.cities)
  for (const [gb, c] of entries) {
    lines.push(`  - ${gb} → ${c.owner}（驻军 ${c.troops}k，士气 ${c.morale}）`)
  }

  if (snap.battles.length) {
    lines.push('\n进行中的战斗：')
    for (const b of snap.battles) {
      lines.push(`  - ${b.id}：${b.fromName ?? b.from} → ${b.toName ?? b.to}`)
    }
  }

  return lines.join('\n')
}

export interface BuildMessagesOpts {
  userText: string
  /** 是否把当前全局世界态注入为一条 system 消息。默认关：当前快照以 gb 码列城市，与契约「用中文名指令」不一致，且全量快照会显著拉长上下文、增加 token 成本；需全局态势感知时手动开启。 */
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
    messages.push({ role: 'system', content: '当前世界态：\n' + buildWorldSnapshot() })
  }

  messages.push({ role: 'user', content: opts.userText })
  return messages
}
