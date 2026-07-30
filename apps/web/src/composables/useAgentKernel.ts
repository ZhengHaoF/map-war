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
import { normalizeCommsFrom } from '@/utils/commsEntity'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { classifyFactions } from '@/utils/aiClassify'
import {
  buildFactionContext,
  buildMinorContext,
  buildSettleContext,
  validateFactionOrders,
  validateFactionOrder,
  decideFaction,
  runWorldBatch,
  runWorldSettle,
} from '@/utils/ai'
import type { GameOrder } from '@/utils/gameOrders'
import type { WorldSettleResult } from '@/utils/ai'
import { Owner, OWNER_LABELS, OWNER_DETAILS } from '@/data/owners'
import { useToast } from '@/composables/useToast'
import { computeFactionEconomy } from '@/utils/economy'
import type { EconomyTickEntry } from '@/stores/game'

import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import type { DiplomaticProposal } from '@/utils/ai/factionAi'

// ─── 模块级单例 ───
const loading = ref(false)
const phase = ref<'idle' | 'classifying' | 'ai' | 'advancing' | 'settling' | 'done' | 'error'>('idle')
const progress = ref('')
const lastError = ref('')
const { push: pushToast } = useToast()

/** 调用专属政权 AI，返回通过结构 + 战略校验的 GameOrder[] + 可选电报 + 可选外交提案。 */
async function invokeFactionAI(
  faction: Owner,
  context: string,
): Promise<{ orders: GameOrder[]; telegram?: string; diplomaticProposal?: DiplomaticProposal }> {
  const result = await decideFaction(faction, context)
  return result
}

/** 调用世界 AI 批量生成 minor 政权事件 */
async function invokeWorldAIBatch(
  _factions: Owner[],
  context: string,
): Promise<GameOrder[]> {
  const { orders: rawOrders, errors: rawErrors, parseSucceeded } = await runWorldBatch(context)

  // 仅解析失败才弹 toast；合法的空 orders（次要势力按兵不动）静默通过
  if (!parseSucceeded) {
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

  // 按每条指令的 actor 独立做战略校验
  const store = useGameStore()
  const strategicOk: GameOrder[] = []
  for (let i = 0; i < rawOrders.length; i++) {
    // 门卫：结构校验不过的指令（未知指令名 / 非法字段）直接丢弃，不让它漏到执行层
    if (rawErrors[i]?.length) {
      console.warn('[世界AI批量] 结构校验失败，丢弃指令:', rawOrders[i], rawErrors[i])
      continue
    }

    const order = rawOrders[i]
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
      (gb) => store.ownership[gb],
      (gb) => store.cities[gb]?.troops,
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
): Promise<WorldSettleResult> {
  return runWorldSettle(currentDate)
}

// ─── 公开 API ───

/**
 * P0 经济结算：每回合开局先算各势力收支（本地确定性公式，零 LLM）。
 * 经 applyEvent('economicTick') 落地——明细入 eventLog，replay 重放确定性一致。
 * 欠饷扣士气、缺粮损兵的惩罚由 reducer 内部执行。
 * 玩家相关：若本方欠饷/缺粮则弹 toast 预警。
 */
function runEconomicTick(): void {
  const store = useGameStore()
  const entries: EconomyTickEntry[] = []
  for (const f of store.activeFactions) {
    const eco = computeFactionEconomy(store.cities, f)
    const arrear = eco.silverNet < 0 && store.getTreasury(f) + eco.silverNet < 0
    const famine = eco.foodNet < 0 && store.getGranary(f) + eco.foodNet < 0
    entries.push({
      faction: f,
      silverDelta: eco.silverNet,
      foodDelta: eco.foodNet,
      silverTax: eco.silverTax,
      silverUpkeep: eco.silverUpkeep,
      foodProduce: eco.foodProduce,
      foodUpkeep: eco.foodUpkeep,
      arrear,
      famine,
    })
  }
  store.applyEvent({ type: 'economicTick', entries })

  // 玩家预警
  const pf = store.currentFaction
  if (pf) {
    const me = entries.find((e) => e.faction === pf)
    if (me?.arrear) {
      pushToast({ icon: 'alert-triangle', tone: 'error', title: '欠饷', text: `银库空虚，全军士气低落（余 ${store.getTreasury(pf)} 万银）` })
    }
    if (me?.famine) {
      pushToast({ icon: 'alert-triangle', tone: 'amber', title: '缺粮', text: `粮草不继，驻军减员（余 ${store.getGranary(pf)} 万石）` })
    }
  }
}

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

  // ── P0: 经济结算（每回合开局先收税扣养兵，AI 据新国库决策）──
  runEconomicTick()

  // ── P2: 分类 ──
  phase.value = 'classifying'
  progress.value = '分析势力关系…'

  const snap = store.getSnapshot()
  const { related, unrelated } = classifyFactions({
    playerFaction: snap.currentFaction,
    activeFactions: snap.activeFactions,
    ownership: snap.ownership,
    eventLog: [...store.eventLog],
    relations: snap.relations,
  })

  progress.value = `related: ${related.length}, unrelated: ${unrelated.length}`

  // ── P3: 并行 AI ──
  phase.value = 'ai'
  progress.value = '政权 AI 决策中…'

  const allOrders: GameOrder[] = []

  // 并行：related 各自独立 + unrelated 批量一次
  // invokeFactionAI 返回 { orders, telegram }；invokeWorldAIBatch 返回 GameOrder[]
  const factionPromises: { faction: Owner; promise: Promise<{ orders: GameOrder[]; telegram?: string; diplomaticProposal?: DiplomaticProposal }> }[] = []
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

  // 收集 related 势力的指令 + 电报 + 外交提案
  let telegramCount = 0
  const MAX_TELEGRAMS_PER_TURN = 2
  let playerDiplomacyProposed = false
  const diplomacyBus = useDiplomacyBus()

  factionResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') return
    const { orders, telegram, diplomaticProposal } = r.value
    const faction = factionPromises[i].faction
    if (orders.length) allOrders.push(...orders)
    // 电报：软上限每回合 2 封
    if (telegram && telegramCount < MAX_TELEGRAMS_PER_TURN) {
      store.pushTelegram({
        gameDate: snap.currentDate,
        from: faction,
        to: 'PLAYER',
        content: telegram,
        channel: 'direct',
        turn: store.turnCount,
        leaderName: OWNER_DETAILS[faction]?.leader,
      })
      telegramCount++
    }
    // 外交提案
    if (diplomaticProposal && diplomaticProposal.target) {
      if (diplomaticProposal.target === snap.currentFaction) {
        if (!playerDiplomacyProposed) {
          diplomacyBus.startAiDiplomacy(
            faction,
            diplomaticProposal.target,
            diplomaticProposal.intent,
            diplomaticProposal.message,
            diplomaticProposal.conditions,
          )
          playerDiplomacyProposed = true
        }
      } else {
        diplomacyBus.startAiDiplomacy(
          faction,
          diplomaticProposal.target,
          diplomaticProposal.intent,
          diplomaticProposal.message,
          diplomaticProposal.conditions,
        )
      }
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

  // ── P4a: 战斗裁决 ──
  const activeBattles = store.battles.filter((b) => b.active)
  if (activeBattles.length > 0) {
    phase.value = 'settling'
    progress.value = '战斗裁决中…'
    await scheduler.settleActiveBattles()
  }

  // ── P4 结算 ──
  phase.value = 'settling'
  progress.value = '世界 AI 总结中…'

  // P4 user 消息由 buildSettleContext 内部生成（#5.3：buildSettleContext 自取 sinceDateAdvance 历史）
  const { narrative, newDate, chatter } = await invokeWorldAISettle(snap.currentDate)

  // 系统结算叙事落 eventLog（kind='settlement' 让 aiHistory 不带"玩家："前缀）
  store.applyEvent({ type: 'narrative', playerInput: '', aiMessage: narrative, kind: 'settlement' })

  // 世界公屏电报：from 是 AI 返回的中文势力名，归一化回内部代码
  if (chatter.length) {
    for (const c of chatter) {
      store.pushTelegram({
        gameDate: newDate,
        from: normalizeCommsFrom(c.from),
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
