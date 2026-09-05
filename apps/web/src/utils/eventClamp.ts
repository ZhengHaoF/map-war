/**
 * 事件数值钳制 —— reducer 级宽松兜底（纯函数、确定性、replay 安全）。
 *
 * 职责：任何来源（freeAction / 外交条约 / 国家援助 / 未来新发射方）的
 * 超限数值在进入 applyEvent 前收敛到安全区间，防止 LLM 抽风或话术白嫖。
 *
 * 设计原则（与 clampFlavor 同源）：
 * - 确定性：同一事件多次钳制结果恒等，读档重放不发散；
 * - 只收上限，不收合法性：城市存在性/归属等语义校验仍由 preCheck 负责；
 * - 宽松兜底：正常路径（内政/战斗/外交）的合法值远低于上限，只有离谱值被收敛。
 */
import type { GameEvent } from '@/stores/game'
import {
  REDUCER_CAP_TREASURY,
  REDUCER_CAP_GRANARY,
  REDUCER_CAP_PRODUCE,
  REDUCER_CAP_CITY_STAT,
  REDUCER_CAP_MORALE,
} from '@/data/gameConfig'

/** 数值收敛到 [min, max]；NaN/±Infinity 落到 min（安全方向：负值上限或 0） */
function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

/**
 * 对事件中的数值字段做兜底钳制。不匹配类型原样返回（不变引用）。
 * 钳制后返回新对象（不可变更新），调用方把返回值作为后续处理的事件。
 */
export function clampEventMagnitude(e: GameEvent): GameEvent {
  switch (e.type) {
    case 'treasuryChange':
      return { ...e, delta: clampNum(e.delta, -REDUCER_CAP_TREASURY, REDUCER_CAP_TREASURY) }
    case 'granaryChange':
      return { ...e, delta: clampNum(e.delta, -REDUCER_CAP_GRANARY, REDUCER_CAP_GRANARY) }
    case 'produce':
      // 征兵不可为负（负 amount 会反向扣兵，属非法输入）
      return { ...e, amount: clampNum(e.amount, 0, REDUCER_CAP_PRODUCE) }
    case 'cityStatChange':
      return { ...e, delta: clampNum(e.delta, -REDUCER_CAP_CITY_STAT, REDUCER_CAP_CITY_STAT) }
    case 'moraleChange':
      return { ...e, delta: clampNum(e.delta, -REDUCER_CAP_MORALE, REDUCER_CAP_MORALE) }
    default:
      return e
  }
}
