/**
 * Agent-Kernel 调度器（含 P4a 战斗结算）。
 *
 * 把「AI 返回的一批 GameOrder」当成一个待播放队列，按顺序串行消费：
 * - 普通指令直接走 executeOrder（动画 + 状态变更是原子的，await 即同步）；
 * - setCurrentDate 走 playTimeJump：云雾蒙太奇盖屏 → 中点改日期 → 揭开；
 * - 任意指令带 needsPlayerDecision=true 时停下，把控制权交还玩家。
 *
 * P4a 战斗结算：队列消费完后、dateAdvance 之前，遍历 ACTIVE 战斗逐场结算。
 *
 * 设计要点（来自 grill 结论）：
 * - 队列是运行时态、不持久化；读档后由世界 AI 重新生成。
 * - reducer（applyEvent）完全不碰，本调度器只负责「何时消费、按什么顺序、是否停」。
 * - 同步不靠新锁：串行 for...await 一条播完才取下一条；现有重入锁在串行下不会触发。
 *
 * 模块级单例：调试面板与未来的玩家 UI 共享同一队列与推进循环。
 */

import { ref } from 'vue'
import { executeOrder, playTimeJump } from '@/utils/gameOrders'
import type { GameOrder } from '@/utils/gameOrders'
import { useToast } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import type { CityState } from '@/stores/game'
import type { Owner } from '@/data/owners'
import { callLlm } from '@/composables/useLlmClient'
import { extractPayloads } from '@/utils/aiParse'
import { buildBattleSettlePrompt, buildBattleSummary } from '@/utils/aiPromptBuilder'

export type AdvanceStatus = 'idle' | 'running' | 'done' | 'stopped'

// ─── 模块级单例状态（调试面板 / 玩家 UI 共享同一队列）───
const queue = ref<GameOrder[]>([])
const status = ref<AdvanceStatus>('idle')
const stoppedAt = ref<GameOrder | null>(null)
const { push: pushToast } = useToast()

/**
 * 把一批指令入队（不立即执行）。
 * @param orders 通过结构校验的 GameOrder 列表
 */
function submit(orders: GameOrder[]): void {
  queue.value.push(...orders)
}

/**
 * P4a 战斗兜底公式（仅 AI 失败/漏裁时用）。
 * 简单考虑兵力比与守方工事，每回合各损约 5-10%。
 */
function fallbackTick(atkFieldForce: number, defTroops: number, fort: number): { attackerLoss: number; defenderLoss: number } {
  const ratio = atkFieldForce / Math.max(defTroops, 1)
  const baseRate = 0.06
  // fort 范围 0-100，归一化为 0-1 的系数影响（最高让攻方损耗翻倍）
  const fortFactor = 1 + (fort / 100) * 1.0
  const attackerLoss = Math.max(1, Math.round(atkFieldForce * baseRate * fortFactor))
  const defenderLoss = Math.max(1, Math.round(defTroops * baseRate * Math.min(ratio, 3)))
  return { attackerLoss, defenderLoss }
}

/**
 * P4a 战斗结算：遍历 ACTIVE 战斗，优先走 LLM 裁决，fallback 用兜底公式。
 */
async function settleActiveBattles(): Promise<void> {
  const store = useGameStore()
  const active = store.battles.filter((b) => b.active)
  if (!active.length) return

  // ── 第一步：尝试 LLM 战斗裁决 ──
  type Resolution = { attackerLoss: number; defenderLoss: number; narrative?: string }
  const llmResolutions: Record<string, Resolution> = {}
  const summary = buildBattleSummary()
  if (summary) {
    try {
      const raw = await callLlm({
        messages: [
          { role: 'system', content: buildBattleSettlePrompt() },
          { role: 'user', content: summary },
        ],
        maxRetries: 2,
      })
      const payloads = extractPayloads(raw)
      const obj = payloads[0] as Record<string, unknown> | undefined
      const list = (obj?.resolutions as Array<{ battleId?: string; attackerLoss?: number; defenderLoss?: number; narrative?: string }>) ?? []
      for (const r of list) {
        if (r.battleId && typeof r.attackerLoss === 'number' && typeof r.defenderLoss === 'number') {
          llmResolutions[r.battleId] = { attackerLoss: r.attackerLoss, defenderLoss: r.defenderLoss, narrative: r.narrative }
        }
      }
    } catch (e) {
      console.warn('[P4a] LLM 战斗裁决失败，全部走 fallback 兜底', e)
    }
  }

  // ── 第二步：逐场结算 ──
  for (const b of active) {
    const cities = store.cities as unknown as Record<string, CityState>
    const from = cities[b.from]
    const to = cities[b.to]
    if (!from || !to) continue

    // 偷家检测：攻方来源城已被第三方占领
    if (from.owner !== b.attacker) {
      store.applyEvent({ type: 'battleEnd', battleId: b.id, reason: 'attackerRouted' })
      pushToast({ icon: 'skull', tone: 'error', title: '战线崩溃', text: `${b.fromName} 被占，前线溃散` })
      continue
    }

    // 攻方无兵可战
    if (from.fieldForce <= 0) {
      store.applyEvent({ type: 'battleEnd', battleId: b.id, reason: 'attackerRouted' })
      pushToast({ icon: 'skull', tone: 'error', title: '攻方溃败', text: `${b.fromName} 无兵可战` })
      continue
    }

    // 守方归零 → 占领
    if (to.troops <= 0) {
      const remaining = from.fieldForce
      store.applyEvent({ type: 'capture', targetGb: b.to, actor: b.attacker, resultTroops: remaining })
      store.applyEvent({ type: 'battleEnd', battleId: b.id, reason: 'capture' })
      pushToast({ icon: 'flag', tone: 'cinnabar', title: '城池陷落', text: `${b.toName} 被 ${b.attacker} 占领（进驻 ${remaining}k 兵）` })
      continue
    }

    // 正常结算：优先 LLM 裁决，缺则 fallback
    const resolution = llmResolutions[b.id]
    let attackerLoss: number
    let defenderLoss: number
    if (resolution) {
      attackerLoss = Math.max(1, Math.min(Math.round(resolution.attackerLoss), from.fieldForce))
      defenderLoss = Math.max(1, Math.min(Math.round(resolution.defenderLoss), to.troops))
    } else {
      const fort = to.fort ?? 0
      ;({ attackerLoss, defenderLoss } = fallbackTick(from.fieldForce, to.troops, fort))
    }

    store.applyEvent({ type: 'attack', fromGb: b.from, targetGb: b.to, attackerLoss, defenderLoss })

    // 结算后再次检查终止条件
    const finalFrom = cities[b.from]
    const finalTo = cities[b.to]
    if (!finalFrom || !finalTo) continue

    if (finalTo.troops <= 0) {
      const remaining = finalFrom.fieldForce
      store.applyEvent({ type: 'capture', targetGb: b.to, actor: b.attacker, resultTroops: remaining })
      store.applyEvent({ type: 'battleEnd', battleId: b.id, reason: 'capture' })
      pushToast({ icon: 'flag', tone: 'cinnabar', title: '城池陷落', text: `${b.toName} 被 ${b.attacker} 占领（进驻 ${remaining}k 兵）` })
    } else if (finalFrom.fieldForce <= 0) {
      store.applyEvent({ type: 'battleEnd', battleId: b.id, reason: 'attackerRouted' })
      pushToast({ icon: 'skull', tone: 'error', title: '攻方溃败', text: `${b.fromName} 兵锋耗尽` })
    }
  }
}

/**
 * 串行推进队列：逐条消费直到跑完或遇到 needsPlayerDecision。
 * 队列消费完后，在 dateAdvance 之前插入 P4a 战斗结算。
 * @returns 'done' 队列跑空；'stopped' 遇到停标交还玩家；'running' 已在推进中（直接返回）
 */
async function advance(): Promise<'done' | 'stopped' | 'running'> {
  if (status.value === 'running') return 'running'
  if (!queue.value.length) {
    // 即使没有指令，也要跑 P4a 战斗结算（前线不能停）
    await settleActiveBattles()
    status.value = 'done'
    stoppedAt.value = null
    return 'done'
  }

  status.value = 'running'
  try {
    // 分离 setCurrentDate 指令，先消费其他指令
    const dateOrders: GameOrder[] = []
    const gameOrders: GameOrder[] = []
    for (const o of queue.value) {
      if (o.order === 'setCurrentDate') dateOrders.push(o)
      else gameOrders.push(o)
    }
    queue.value = gameOrders

    // P1 + P3：消费所有非日期指令
    while (queue.value.length) {
      const order = queue.value.shift()!
      try {
        await executeOrder(order)
      } catch (e) {
        // 单条失败不打断整批：告警后继续下一条
        // eslint-disable-next-line no-console
        console.warn('[scheduler] 指令执行失败，跳过：', order, e)
        pushToast({ icon: 'alert-triangle', tone: 'error', title: '指令出错', text: '推演中一条指令失败，已跳过' })
      }

      // 世界 AI 标注「需玩家决策」→ 在此停下交还
      if (order.needsPlayerDecision) {
        stoppedAt.value = order
        status.value = 'stopped'
        pushToast({ icon: 'alert-triangle', tone: 'cinnabar', title: '请主公定夺', text: '局势有变，控制权已交还' })
        return 'stopped'
      }
    }

    // P4a：战斗结算（在 dateAdvance 之前）
    await settleActiveBattles()

    // P4b：时间推进（云雾蒙太奇 + 日期变更）
    for (const d of dateOrders) {
      await playTimeJump(d.date!)
    }

    stoppedAt.value = null
    status.value = 'done'
    return 'done'
  } catch {
    status.value = 'done'
    return 'done'
  }
}

export function useGameScheduler() {
  return { queue, status, stoppedAt, submit, advance }
}
