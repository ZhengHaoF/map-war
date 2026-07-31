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
import { executeOrder, playTimeJump, stopBattleVisual } from '@/utils/gameOrders'
import type { GameOrder } from '@/utils/gameOrders'
import { useToast } from '@/composables/useToast'
import { useGameStore } from '@/stores/game'
import type { BattleEndReason, CityState } from '@/stores/game'
import { flavorBattles } from '@/utils/ai'
import { computeBaseBattle, clampFlavor, checkMoraleCollapse } from '@/utils/battleFormula'
import type { BaseResult, FlavorResult, FlavorEvent } from '@/utils/battleFormula'
import { distanceBetween } from '@/utils/locationResolver'
import { expeditionFactor } from '@/utils/economy'
import { BATTLE_MIN_ATTRITION_PER_ROUND } from '@/data/gameConfig'

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
 * P4a 战斗结算：本地公式为主干、AI 为调味层。
 */
async function settleActiveBattles(): Promise<void> {
  const store = useGameStore()
  const active = store.battles.filter((b) => b.active)
  if (!active.length) return

  // 本地 helper：灭光柱 + applyEvent 同步收口，避免光柱残留 bug
  const endBattle = (id: string, reason: BattleEndReason) => {
    stopBattleVisual(id)
    store.applyEvent({ type: 'battleEnd', battleId: id, reason })
  }

  // ── 第一阶段：前置检查 + 本地公式（不展示） ──
  const baseResults = new Map<string, BaseResult>()
  const validBattles: (typeof active)[number][] = []

  for (const b of active) {
    const cities = store.cities as unknown as Record<string, CityState>
    const from = cities[b.from]
    const to = cities[b.to]
    if (!from || !to) continue

    // 偷家检测：攻方来源城已被第三方占领
    if (from.owner !== b.attacker) {
      endBattle(b.id, 'attackerRouted')
      pushToast({ icon: 'skull', tone: 'error', title: '战线崩溃', text: `${b.fromName} 被占，前线溃散` })
      continue
    }

    // 攻方来源城无外出兵力：本不该开战（开战入口已拦截），属异常兜底。
    if (from.fieldForce <= 0) {
      endBattle(b.id, 'retreat')
      pushToast({ icon: 'player-stop', tone: 'neutral', title: '战线撤销', text: `${b.fromName} 未驻前线兵力，对峙作罢` })
      continue
    }

    // 守方已归零 → 直接占领（跳过公式，无仗可打）
    if (to.troops <= 0) {
      const remaining = from.fieldForce
      store.applyEvent({ type: 'capture', targetGb: b.to, actor: b.attacker, resultTroops: remaining })
      endBattle(b.id, 'capture')
      pushToast({ icon: 'flag', tone: 'cinnabar', title: '城池陷落', text: `${b.toName} 被 ${b.attacker} 占领（进驻 ${remaining}k 兵）` })
      continue
    }

    // 本地公式：确定性基础减员 + 士气变化
    // 远征战力衰减：从 fromGb/targetGb 重算距离，传入 distanceFactor
    const dist = distanceBetween(b.from, b.to)
    const distFactor = dist !== null ? expeditionFactor(dist) : 1.0
    baseResults.set(
      b.id,
      computeBaseBattle({
        atkForce: from.fieldForce,
        defTroops: to.troops,
        atkMorale: from.morale,
        defMorale: to.morale,
        fort: to.fort ?? 0,
        terrain: to.terrain,
        distanceFactor: distFactor,
      }),
    )
    validBattles.push(b)
  }

  if (!validBattles.length) return

  // ── 第二阶段：AI 调味（尽力而为，失败不阻塞）───
  const flavorMap = await flavorBattles(validBattles, baseResults)

  // ── 第三阶段：钳制 AI 调味 + 合并 + apply ──
  for (const b of validBattles) {
    const cities = store.cities as unknown as Record<string, CityState>
    const from = cities[b.from]
    const to = cities[b.to]
    if (!from || !to) continue

    const base = baseResults.get(b.id)!
    const rawFlavor = flavorMap[b.id] ?? { events: [] }
    const flavor = clampFlavor(rawFlavor, base)

    // 合并：基础 + AI shock 突发减员
    let attackerShock = 0
    let defenderShock = 0
    for (const e of flavor.events) {
      if (e.type === 'shock') {
        if (e.side === 'attacker') attackerShock += e.magnitude ?? 0
        else defenderShock += e.magnitude ?? 0
      }
    }
    const finalAttackerLoss = Math.min(
      Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.attackerLoss + attackerShock),
      from.fieldForce,
    )
    const finalDefenderLoss = Math.min(
      Math.max(BATTLE_MIN_ATTRITION_PER_ROUND, base.defenderLoss + defenderShock),
      to.troops,
    )

    // applyEvent(attack) — 兵力损耗
    store.applyEvent({
      type: 'attack',
      fromGb: b.from,
      targetGb: b.to,
      attackerLoss: finalAttackerLoss,
      defenderLoss: finalDefenderLoss,
      narrative: flavor.narrative,
    })

    // applyEvent(moraleChange) — 公式士气损耗
    if (base.atkMoraleDelta !== 0) {
      store.applyEvent({
        type: 'moraleChange',
        targetGb: b.from,
        delta: base.atkMoraleDelta,
      })
    }
    if (base.defMoraleDelta !== 0) {
      store.applyEvent({
        type: 'moraleChange',
        targetGb: b.to,
        delta: base.defMoraleDelta,
      })
    }

    // applyEvent(moraleChange) — AI 士气扰动
    for (const e of flavor.events) {
      if (e.type === 'morale') {
        const targetGb = e.side === 'attacker' ? b.from : b.to
        store.applyEvent({
          type: 'moraleChange',
          targetGb,
          delta: e.delta ?? 0,
        })
      }
    }

    // ── 第四阶段：终局复检 ──
    const finalFrom = cities[b.from]
    const finalTo = cities[b.to]
    if (!finalFrom || !finalTo) continue

    // ② 士气崩溃（优先于归零，守方优先判定）
    const collapse = checkMoraleCollapse({
      battleId: b.id,
      turns: store.battles.find((x) => x.id === b.id)?.turns ?? 0,
      atkMorale: finalFrom.morale,
      defMorale: finalTo.morale,
    })
    if (collapse === 'defender') {
      store.applyEvent({
        type: 'capture',
        targetGb: b.to,
        actor: b.attacker,
        resultTroops: finalFrom.fieldForce,
      })
      endBattle(b.id, 'defenderCollapse')
      pushToast({ icon: 'flag', tone: 'purple', title: '军心瓦解', text: `${b.toName} 守军士气崩溃，城池陷落` })
      continue
    }
    if (collapse === 'attacker') {
      endBattle(b.id, 'attackerCollapse')
      pushToast({ icon: 'skull', tone: 'purple', title: '军心瓦解', text: `${b.fromName} 攻军士气崩溃，全线溃散` })
      continue
    }

    // ① 兵力归零（原逻辑保留）
    if (finalTo.troops <= 0) {
      const remaining = finalFrom.fieldForce
      store.applyEvent({ type: 'capture', targetGb: b.to, actor: b.attacker, resultTroops: remaining })
      endBattle(b.id, 'capture')
      pushToast({ icon: 'flag', tone: 'cinnabar', title: '城池陷落', text: `${b.toName} 被 ${b.attacker} 占领（进驻 ${remaining}k 兵）` })
    } else if (finalFrom.fieldForce <= 0) {
      endBattle(b.id, 'attackerRouted')
      pushToast({ icon: 'skull', tone: 'error', title: '攻方溃败', text: `${b.fromName} 兵锋耗尽` })
    }
  }
}

/**
 * 串行推进队列：逐条消费直到跑完或遇到 needsPlayerDecision。
 * 不结算战斗（P4a 已移至 useAgentKernel.runWorldTurn 的 P3 推进之后）。
 * @returns 'done' 队列跑空；'stopped' 遇到停标交还玩家；'running' 已在推进中（直接返回）
 */
async function advance(): Promise<'done' | 'stopped' | 'running'> {
  if (status.value === 'running') return 'running'
  if (!queue.value.length) {
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
  return { queue, status, stoppedAt, submit, advance, settleActiveBattles }
}
