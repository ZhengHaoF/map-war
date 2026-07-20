/**
 * Agent-Kernel 编排器 —— 回合 P2/P3/P4 的路由中枢。
 *
 * 职责：
 * - 玩家点「结束回合」→ endPlayerTurn() 排空残留 → P2 分流调度
 * - P2: classifyFactions() → related(专属AI) / unrelated(世界AI批量)
 * - P3: 并行 LLM 决策 → parse → submit → advance() 串行演出
 * - P4: 世界 AI 读 eventLog → 叙事 → 推进日期
 *
 * 模块级单例（同 useGameScheduler 模式）：PlayerAiPanel 与地图层共享同一个编排器状态。
 */

import { ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { classifyFactions } from '@/utils/aiClassify'
import { buildFactionSystemPrompt } from '@/utils/aiPromptBuilder'
import { validateOrders } from '@/utils/aiOrderContract'
import { extractPayloads, extractAiMessage, unwrapData } from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { useToast } from '@/composables/useToast'

// ─── 模块级单例 ───
const loading = ref(false)
const phase = ref<'idle' | 'classifying' | 'ai' | 'advancing' | 'settling' | 'done' | 'error'>('idle')
const progress = ref('')
const lastError = ref('')
const { push: pushToast } = useToast()

/** 单次 AI 调用（不经 Vue 响应式，适合并行） */
async function callAI(messages: { role: string; content: string }[]): Promise<unknown> {
  const MAX_RETRIES = 3
  let lastErr: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const detail =
          (errBody as { detail?: string })?.detail ??
          (errBody as { error?: string })?.error ??
          `HTTP ${res.status}`
        throw new Error(detail)
      }
      return await res.json()
    } catch (err) {
      lastErr = err as Error
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastErr ?? new Error('AI 调用失败')
}

/** 调用专属政权 AI，返回通过结构校验的 GameOrder[]。 */
async function invokeFactionAI(faction: Owner, context: string): Promise<GameOrder[]> {
  const systemPrompt = buildFactionSystemPrompt(faction)
  const raw = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context },
  ])
  const payloads = extractPayloads(raw)
  const orders: GameOrder[] = []
  for (const p of payloads) {
    const unwrapped = unwrapData(p)
    const batch = validateOrders(unwrapped)
    orders.push(...batch.orders)
  }
  return orders
}

/** 调用世界 AI 批量生成 minor 政权事件 */
async function invokeWorldAIBatch(
  factions: Owner[],
  context: string,
): Promise<GameOrder[]> {
  const systemPrompt = `你是民国军阀推演游戏的「世界 AI」。你负责为次要势力生成本回合的行动。
这些势力不单独配 AI 实例，由你一次性批量生成它们的带日期事件。

返回格式：
{
  "orders": [
    { "order": "battle", "from": "城A", "to": "城B", "actor": "势力中文名" },
    ...
  ]
}

约束：
- 每条指令必须带 actor（指明是哪个势力，用中文名，如"晋系"/"马家军"）
- 只生成合理、小型的行动（调兵/试探进攻），不要改变大局
- 保守为上——次要势力通常按兵不动
- 所有地点用城市中文名`

  const raw = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context },
  ])
  const payloads = extractPayloads(raw)
  const orders: GameOrder[] = []
  for (const p of payloads) {
    const unwrapped = unwrapData(p)
    const batch = validateOrders(unwrapped)
    orders.push(...batch.orders)
  }
  return orders
}

/** 调用世界 AI 做 P4 总结（叙事 + 推进日期） */
async function invokeWorldAISettle(
  roundEvents: string,
  currentDate: string,
): Promise<{ narrative: string; newDate: string }> {
  const systemPrompt = `你是民国军阀推演游戏的「世界 AI」叙事者。本回合各势力的行动已经执行完毕。

请产出：
1. narrative: 2-4 句中文叙事，总结本回合重大事件
2. newDate: 推进后的新日期（ISO 格式），通常推进 5-10 天

返回 JSON 格式：
{ "narrative": "全境战报…", "newDate": "1931-04-10" }`

  const raw = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `当前日期：${currentDate}\n\n本回合事件：\n${roundEvents}` },
  ])
  const payloads = extractPayloads(raw)
  const obj = payloads[0] as Record<string, string> | undefined
  return {
    narrative: obj?.narrative ?? '局势在无声中演变…',
    newDate: obj?.newDate ?? currentDate,
  }
}

/** 构建势力决策上下文（给 faction AI 的 user message） */
function buildFactionContext(faction: Owner): string {
  const store = useGameStore()
  const snap = store.getSnapshot()
  const myCities = Object.entries(snap.cities).filter(([, c]) => c.owner === faction)

  let ctx = `当前日期：${snap.currentDate}\n\n`
  ctx += `你的势力：${OWNER_LABELS[faction] ?? faction}\n`
  ctx += `你控制 ${myCities.length} 座城市，总兵力 ${snap.factionTroops[faction] ?? 0}k\n\n城市详情：\n`
  for (const [gb, c] of myCities) {
    const name = store.cities[gb]?.name ?? gb
    ctx += `  ${name}（驻军 ${c.troops}k，士气 ${c.morale}）\n`
  }

  // 加相邻城市信息（MVP: 不加，靠 AI 地理知识）
  ctx += '（请根据你对民国地理的了解自行判断相邻关系）\n'

  ctx += '\n请决定本回合行动。若无必要，返回空 orders。'
  return ctx
}

/** 构建 minor 政权批量上下文 */
function buildMinorContext(factions: Owner[]): string {
  const store = useGameStore()
  const snap = store.getSnapshot()

  let ctx = `当前日期：${snap.currentDate}\n\n`
  ctx += `以下 ${factions.length} 个次要势力需要你替它们决定本回合行动：\n\n`
  for (const f of factions) {
    const troops = snap.factionTroops[f] ?? 0
    const cityCount = Object.values(snap.cities).filter((c) => c.owner === f).length
    ctx += `- ${OWNER_LABELS[f] ?? f}：${cityCount} 座城，${troops}k 兵力\n`
  }
  ctx += '\n每个势力的行动用 actor 字段标明。保守为上，无大事可按兵不动。'
  return ctx
}

/**
 * 构建本回合事件摘要（给世界 AI P4 叙事用）。
 * 从 eventLog 自上次 dateAdvance 截取。
 */
function buildRoundEventSummary(): string {
  const store = useGameStore()
  let lastAdvIdx = -1
  for (let i = store.eventLog.length - 1; i >= 0; i--) {
    if (store.eventLog[i].type === 'dateAdvance') { lastAdvIdx = i; break }
  }
  const recent = lastAdvIdx >= 0 ? store.eventLog.slice(lastAdvIdx + 1) : store.eventLog
  if (!recent.length) return '（本回合无事件）'

  const lines: string[] = []
  for (const e of recent) {
    switch (e.type) {
      case 'battleStart':
        lines.push(`⚔ ${e.fromName ?? e.fromGb} → ${e.toName ?? e.targetGb} 爆发战斗`)
        break
      case 'capture':
        lines.push(`🏴 ${e.actor} 占领 ${e.targetGb}`)
        break
      case 'moveTroops':
        lines.push(`🚚 ${e.fromGb} → ${e.toGb} 调兵 ${e.amount}k`)
        break
      case 'narrative':
        lines.push(`📜 ${e.playerInput}`)
        break
      case 'attack':
        lines.push(`⚔ 攻城：攻方损失 ${e.attackerLoss}k，守方损失 ${e.defenderLoss}k`)
        break
      default:
        lines.push(`${e.type}`)
    }
  }
  return lines.join('\n')
}

// ─── 公开 API ───

/** 玩家结束回合 → 排空残留指令 → 启动世界回合 */
async function endPlayerTurn(): Promise<void> {
  const store = useGameStore()
  const scheduler = useGameScheduler()

  if (!store.currentFaction) {
    pushToast({ icon: 'alert-triangle', tone: 'error', title: '未选势力', text: '请先选择势力再结束回合' })
    return
  }

  loading.value = true
  lastError.value = ''
  phase.value = 'classifying'

  try {
    // 排空玩家残留指令
    phase.value = 'advancing'
    progress.value = '排空玩家残留指令…'
    await scheduler.advance()

    // 启动世界回合
    await runWorldTurn()
  } catch (err) {
    lastError.value = (err as Error).message || '未知错误'
    phase.value = 'error'
    pushToast({ icon: 'alert-triangle', tone: 'cinnabar', title: '回合推演失败', text: lastError.value })
  } finally {
    loading.value = false
    if (phase.value !== 'error') phase.value = 'done'
  }
}

/** P2→P3→P4 世界回合主循环 */
async function runWorldTurn(): Promise<void> {
  const store = useGameStore()
  const scheduler = useGameScheduler()

  // ── P2: 分类 ──
  phase.value = 'classifying'
  progress.value = '分析势力关系…'

  const snap = store.getSnapshot()
  const { related, unrelated } = classifyFactions({
    playerFaction: snap.currentFaction,
    activeFactions: snap.activeFactions,
    ownership: snap.ownership,
    playerCities: Object.keys(snap.cities).filter((gb) => snap.cities[gb].owner === snap.currentFaction),
    eventLog: [...store.eventLog],
  })

  progress.value = `related: ${related.length}, unrelated: ${unrelated.length}`

  // ── P3: 并行 AI ──
  phase.value = 'ai'
  progress.value = '政权 AI 决策中…'

  const allOrders: GameOrder[] = []

  // 并行：related 各自独立 + unrelated 批量一次
  const promises: Promise<GameOrder[]>[] = []

  for (const f of related) {
    const ctx = buildFactionContext(f)
    promises.push(invokeFactionAI(f, ctx))
  }

  if (unrelated.length > 0) {
    const ctx = buildMinorContext(unrelated)
    promises.push(invokeWorldAIBatch(unrelated, ctx))
  }

  // 并行等待
  const results = await Promise.allSettled(promises)

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length) {
      allOrders.push(...r.value)
    }
  }

  if (allOrders.length) {
    scheduler.submit(allOrders)
  }

  // ── P3 推进（串行演出）──
  phase.value = 'advancing'
  progress.value = `执行 ${allOrders.length} 条指令…`
  await scheduler.advance()

  // ── P4 结算 ──
  phase.value = 'settling'
  progress.value = '世界 AI 总结中…'

  const roundSummary = buildRoundEventSummary()
  const { narrative, newDate } = await invokeWorldAISettle(roundSummary, snap.currentDate)

  // 叙事落 eventLog
  store.applyEvent({ type: 'narrative', playerInput: '【回合结算】', aiMessage: narrative })

  // 推进日期
  if (newDate !== snap.currentDate) {
    store.applyEvent({ type: 'dateAdvance', date: newDate })
  }

  phase.value = 'done'
  progress.value = '新回合开始'

  pushToast({ icon: 'check', tone: 'green', title: '回合结束', text: `日期推进至 ${newDate}` })
}

export function useAgentKernel() {
  return {
    loading,
    phase,
    progress,
    lastError,
    endPlayerTurn,
    runWorldTurn,
  }
}
