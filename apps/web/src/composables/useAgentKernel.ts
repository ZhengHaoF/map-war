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
import { useGameStore, type Telegram } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { callLlm } from '@/composables/useLlmClient'
import { classifyFactions } from '@/utils/aiClassify'
import { buildFactionSystemPrompt } from '@/utils/aiPromptBuilder'
import { buildFactionContext, buildMinorContext, buildSettleContext } from '@/utils/aiContext'
import { validateOrders, validateFactionOrders, validateFactionOrder, type StrategicRuleResult } from '@/utils/aiOrderContract'
import { invokeAgentDecision, type InvokeAgentDecisionResult } from '@/utils/aiInvoke'
import { extractPayloads, extractAiMessage, unwrapData } from '@/utils/aiParse'
import type { GameOrder } from '@/utils/gameOrders'
import { Owner, OWNER_LABELS, OWNER_DETAILS } from '@/data/owners'
import { useToast } from '@/composables/useToast'

// ─── 模块级单例 ───
const loading = ref(false)
const phase = ref<'idle' | 'classifying' | 'ai' | 'advancing' | 'settling' | 'done' | 'error'>('idle')
const progress = ref('')
const lastError = ref('')
const { push: pushToast } = useToast()

/** 调用专属政权 AI，返回通过结构 + 战略校验的 GameOrder[] + 可选电报。 */
async function invokeFactionAI(faction: Owner, context: string): Promise<{ orders: GameOrder[]; telegram?: string }> {
  const store = useGameStore()
  const result: InvokeAgentDecisionResult = await invokeAgentDecision({
    systemPrompt: buildFactionSystemPrompt(faction),
    userContext: context,
  })
  if (!result.parseSucceeded) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: `${OWNER_LABELS[faction] ?? faction} 输出格式错误`,
      text: 'AI 返回无法解析为 JSON',
    })
    return { orders: [] }
  }
  // 提取电报（可选字段）
  let telegram: string | undefined
  const payloads = extractPayloads(result.raw)
  if (payloads.length) {
    const obj = payloads[0] as Record<string, unknown> | undefined
    if (obj && typeof obj.telegram === 'string' && obj.telegram.trim()) {
      telegram = obj.telegram.trim()
    }
  }
  // 1. 取出结构校验通过的指令
  const structureOk = result.orders.filter((_, i) => !result.errors[i].length)
  // 2. 战略校验：actor 必为自身、from/to 必为己方等（零 LLM 成本，#4 改动）
  const strategic = validateFactionOrders(
    structureOk,
    faction,
    (gb) => store.ownership[gb],
    (gb) => store.cities[gb]?.troops,
  )
  // 3. 被拒指令逐条推 toast（replay 安全：runWorldTurn 内调用）
  for (const r of strategic.rejected) {
    const fname = OWNER_LABELS[faction] ?? faction
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: `${fname} 越权`,
      text: r.reason,
    })
  }
  return { orders: strategic.approved, telegram }
}

/** 调用世界 AI 批量生成 minor 政权事件 */
async function invokeWorldAIBatch(
  factions: Owner[],
  context: string,
): Promise<GameOrder[]> {
  const systemPrompt = `你是民国军阀推演游戏的「世界 AI」。你负责为次要势力生成本回合的行动。
这些势力不单独配 AI 实例，由你一次性批量生成它们的带日期事件。

上下文中的城市信息使用紧凑格式：
  城名 驻军Xk 士气X 地形 L城级 工事X
  - 驻军：单位千（k）；士气：0-100
  - 地形：山地/丘陵/平原/林地；L城级：城市等级 1-5
  - 工事：0-100，越高城防越强
  （工业/粮食/工事数值范围均为 0-100）

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

  const result = await invokeAgentDecision({ systemPrompt, userContext: context })
  if (!result.parseSucceeded) {
    pushToast({
      icon: 'alert-triangle',
      tone: 'error',
      title: '世界 AI 输出格式错误',
      text: 'AI 返回无法解析为 JSON',
    })
    return []
  }

  // 反向映射：中文名 → Owner
  const labelToOwner = new Map<string, Owner>()
  for (const [owner, label] of Object.entries(OWNER_LABELS)) {
    labelToOwner.set(label, owner as Owner)
  }

  // 结构校验 + 战略校验（按每条指令的 actor 独立校验）
  const store2 = useGameStore()
  const strategicOk: GameOrder[] = []
  for (let i = 0; i < result.orders.length; i++) {
    if (result.errors[i].length) continue // 结构校验不过，跳过

    const order = result.orders[i]
    const rawActor = (order as unknown as Record<string, unknown>).actor as string | undefined
    const actorOwner = rawActor ? labelToOwner.get(rawActor) : undefined
    if (!actorOwner) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'error',
        title: '未知势力',
        text: `${rawActor ?? '?'}：不在势力表中`,
      })
      continue
    }

    const r = validateFactionOrder(
      order,
      actorOwner,
      (gb) => store2.ownership[gb],
      (gb) => store2.cities[gb]?.troops,
    )
    if (r.ok) {
      strategicOk.push(order)
    } else if (r.reason) {
      pushToast({
        icon: 'alert-triangle',
        tone: 'error',
        title: `${OWNER_LABELS[actorOwner] ?? actorOwner} 越权`,
        text: r.reason,
      })
    }
  }
  return strategicOk
}

/** 调用世界 AI 做 P4 总结（叙事 + 推进日期 + 世界公屏电报） */
async function invokeWorldAISettle(
  currentDate: string,
): Promise<{ narrative: string; newDate: string; chatter: { name?: string; from: string; content: string }[] }> {
  const systemPrompt = `你是民国军阀推演游戏的「世界 AI」叙事者。本回合各势力的行动已经执行完毕。

请产出：
1. narrative: 2-4 句中文叙事，总结本回合重大事件
2. newDate: 推进后的新日期（ISO 格式），通常推进 5-10 天
3. chatter: 1-3 条势力时局短评（世界公屏电报）。以 1-3 个势力的口吻，对本回合局势各发表一句短评。
   - 可以是吃瓜、嘲讽、放话、感慨，不一定跟玩家有关
   - 每条 20-40 字，性格鲜明，半文言
   - from 用势力代号（KMT/CCP/FENG/JIN/GUI 等），name 用领袖名
   - 如果本回合没什么大事，chatter 可以为空数组 []

返回 JSON 格式：
{ "narrative": "全境战报…", "newDate": "1931-04-10", "chatter": [{ "name": "蒋介石", "from": "KMT", "content": "…" }] }`

  // P4 总结返回值结构特殊（narrative + newDate），不走 invokeAgentDecision，直接调 callLlm + 自取字段
  // user 消息走 buildSettleContext：自带当前日期 + sinceDateAdvance 历史 + 引导语（#5.3 改动）
  const raw = await callLlm({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildSettleContext(currentDate) },
    ],
  })
  const payloads = extractPayloads(raw)
  const obj = payloads[0] as Record<string, unknown> | undefined
  const chatterRaw = obj?.chatter as { name?: string; from: string; content: string }[] | undefined
  return {
    narrative: (obj?.narrative as string) ?? '局势在无声中演变…',
    newDate: (obj?.newDate as string) ?? currentDate,
    chatter: Array.isArray(chatterRaw)
      ? chatterRaw.filter((c) => c && typeof c.from === 'string' && typeof c.content === 'string' && c.content.trim())
      : [],
  }
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
    eventLog: [...store.eventLog],
  })

  progress.value = `related: ${related.length}, unrelated: ${unrelated.length}`

  // ── P3: 并行 AI ──
  phase.value = 'ai'
  progress.value = '政权 AI 决策中…'

  const allOrders: GameOrder[] = []

  // 并行：related 各自独立 + unrelated 批量一次
  // invokeFactionAI 返回 { orders, telegram }；invokeWorldAIBatch 返回 GameOrder[]
  const factionPromises: { faction: Owner; promise: Promise<{ orders: GameOrder[]; telegram?: string }> }[] = []
  const batchPromises: Promise<GameOrder[]>[] = []

  for (const f of related) {
    const ctx = buildFactionContext(f)
    factionPromises.push({ faction: f, promise: invokeFactionAI(f, ctx) })
  }

  if (unrelated.length > 0) {
    const ctx = buildMinorContext(unrelated)
    batchPromises.push(invokeWorldAIBatch(unrelated, ctx))
  }

  // 并行等待
  const [factionResults, batchResults] = await Promise.all([
    Promise.allSettled(factionPromises.map((p) => p.promise)),
    Promise.allSettled(batchPromises),
  ])

  // 收集 related 势力的指令 + 电报
  let telegramCount = 0
  const MAX_TELEGRAMS_PER_TURN = 2
  factionResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const { orders, telegram } = r.value
    if (orders.length) allOrders.push(...orders)
    // 电报：软上限每回合 2 封
    if (telegram && telegramCount < MAX_TELEGRAMS_PER_TURN) {
      const faction = factionPromises[i].faction
      store.pushTelegram({
        gameDate: snap.currentDate,
        from: faction,
        content: telegram,
        channel: 'direct',
        turn: store.turnCount,
        leaderName: OWNER_DETAILS[faction]?.leader,
      })
      telegramCount++
    }
  })

  // 收集 unrelated 批量指令
  for (const r of batchResults) {
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

  // P4 user 消息由 buildSettleContext 内部生成（#5.3：buildSettleContext 自取 sinceDateAdvance 历史）
  const { narrative, newDate, chatter } = await invokeWorldAISettle(snap.currentDate)

  // 系统结算叙事落 eventLog（kind='settlement' 让 aiHistory 不带"玩家："前缀）
  store.applyEvent({ type: 'narrative', playerInput: '', aiMessage: narrative, kind: 'settlement' })

  // 世界公屏电报：from 已是势力代号（如 KMT），直接使用
  if (chatter.length) {
    for (const c of chatter) {
      store.pushTelegram({
        gameDate: newDate,
        from: c.from,
        content: c.content,
        channel: 'world',
        turn: store.turnCount,
        leaderName: c.name,
      })
    }
  }

  // 推进日期：入调度器走末尾蒙太奇（playTimeJump 含云雾演出 + toast）
  if (newDate !== snap.currentDate) {
    scheduler.submit([{ order: 'setCurrentDate', date: newDate }])
    await scheduler.advance()
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
