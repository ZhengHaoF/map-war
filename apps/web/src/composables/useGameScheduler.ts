/**
 * Agent-Kernel 调度器（P0 骨架）。
 *
 * 把「AI 返回的一批 GameOrder」当成一个待播放队列，按顺序串行消费：
 * - 普通指令直接走 executeOrder（动画 + 状态变更是原子的，await 即同步）；
 * - setCurrentDate 走 playTimeJump：云雾蒙太奇盖屏 → 中点改日期 → 揭开；
 * - 任意指令带 needsPlayerDecision=true 时停下，把控制权交还玩家。
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

export type AdvanceStatus = 'idle' | 'running' | 'done' | 'stopped'

// ─── 模块级单例状态（调试面板 / 玩家 UI 共享同一队列）───
const queue = ref<GameOrder[]>([])
const status = ref<AdvanceStatus>('idle')
const stoppedAt = ref<GameOrder | null>(null)

/**
 * 把一批指令入队（不立即执行）。
 * @param orders 通过结构校验的 GameOrder 列表
 */
function submit(orders: GameOrder[]): void {
  queue.value.push(...orders)
}

/**
 * 串行推进队列：逐条消费直到跑完或遇到 needsPlayerDecision。
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
    while (queue.value.length) {
      const order = queue.value.shift()!
      try {
        if (order.order === 'setCurrentDate') {
          // 时间跳跃：走云雾蒙太奇，云盖满那一刻才改日期
          await playTimeJump(order.date!)
        } else {
          await executeOrder(order)
        }
      } catch (e) {
        // 单条失败不打断整批：告警后继续下一条
        // eslint-disable-next-line no-console
        console.warn('[scheduler] 指令执行失败，跳过：', order, e)
      }

      // 世界 AI 标注「需玩家决策」→ 在此停下交还
      if (order.needsPlayerDecision) {
        stoppedAt.value = order
        status.value = 'stopped'
        return 'stopped'
      }
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
