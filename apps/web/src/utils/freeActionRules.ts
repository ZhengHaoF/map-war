/**
 * 自由行动（freeAction）effect → 正规指令翻译（纯函数，可单测）。
 *
 * 背景：freeAction 是玩家 AI 的开放行动路径，原实现把 resource 类 effects
 * （produce / moveTroops / 正向内政 / 正向士气）直接 applyEvent——
 * 绕过成本管线（征兵不扣银粮、调兵不扣行军费、建设不扣银），话术即可白嫖。
 *
 * 本模块把「可计费」的 effect 翻译成既有 GameOrder，由 useAiOrchestrator
 * 统一走 validatePlayerOrder + executeOrder（成本校验、归属校验、动画、toast 全复用）。
 *
 * 翻译规则：
 * - produce        → recruit（扣银粮，目标城必须己方）
 * - moveTroops     → moveTroops（扣行军费，from/to 必须己方、不超驻军）
 * - cityStatChange 正向 → develop / fortify（扣银；field=fort 走 fortify）
 * - moraleChange   正向 → rally（按量计费）
 * - 负向士气 / 负向城市属性（宣传/谣言/破坏）→ 返回 null，走直通路径（幅度钳制见 orchestrator）
 * - 其余类型（sendTelegram / relationChange / 银粮 / 非法字段）→ null，走直通路径
 */
import type { GameOrder } from '@/utils/gameOrders'
import type { FreeActionEffect } from '@/utils/aiParse'
import { resolveLocationId } from '@/utils/locationResolver'
import { FREE_CAP_PRODUCE, FREE_CAP_CITY_STAT, FREE_CAP_MORALE_POS } from '@/data/gameConfig'

/** 钳制到 [0, max]；NaN/负值 → 0 */
function clampAmount(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(max, Math.max(0, Math.round(v)))
}

/**
 * 尝试把一个自由行动 effect 翻译成正规指令。
 * @returns GameOrder（走成本管线执行）| null（走直通路径 / 丢弃）
 */
export function freeEffectToOrder(eff: FreeActionEffect): GameOrder | null {
  switch (eff.type) {
    // 征兵 → recruit：扣银粮（目标城归属由 validatePlayerOrder 校验，非己方会被拒）
    case 'produce': {
      if (!eff.targetGb || eff.amount == null) return null
      const gb = resolveLocationId(eff.targetGb)
      if (!gb) return null
      const amount = clampAmount(eff.amount, FREE_CAP_PRODUCE)
      if (amount <= 0) return null
      return { order: 'recruit', gb, amount }
    }
    // 调兵 → moveTroops：扣行军费（from/to 归属与驻军上限由 validatePlayerOrder 校验）
    case 'moveTroops': {
      if (!eff.fromGb || !eff.toGb || eff.amount == null) return null
      const from = resolveLocationId(eff.fromGb)
      const to = resolveLocationId(eff.toGb)
      if (!from || !to) return null
      const amount = clampAmount(eff.amount, Number.MAX_SAFE_INTEGER)
      if (amount <= 0) return null
      return { order: 'moveTroops', from, to, amount }
    }
    // 正向建设 → develop / fortify：扣银（field=fort 走 fortify；负向破坏走直通）
    case 'cityStatChange': {
      if (!eff.targetGb || !eff.field || eff.delta == null) return null
      const field = eff.field as 'industry' | 'food' | 'fort' | 'cityLevel'
      if (field === 'cityLevel') return null // 城级不可经自由行动直接改
      if (eff.delta <= 0) return null // 负向（谍报/焚毁）走直通，幅度钳制在 orchestrator
      const gb = resolveLocationId(eff.targetGb)
      if (!gb) return null
      const amount = clampAmount(eff.delta, FREE_CAP_CITY_STAT)
      if (amount <= 0) return null
      return field === 'fort'
        ? { order: 'fortify', gb, amount }
        : { order: 'develop', gb, field: field as 'industry' | 'food', amount }
    }
    // 正向士气 → rally：按量计费（负向士气/宣传走直通，可对敌城）
    case 'moraleChange': {
      if (!eff.targetGb || eff.delta == null || eff.delta <= 0) return null
      const gb = resolveLocationId(eff.targetGb)
      if (!gb) return null
      const amount = clampAmount(eff.delta, FREE_CAP_MORALE_POS)
      if (amount <= 0) return null
      return { order: 'rally', gb, amount }
    }
    // 其余类型（sendTelegram / relationChange / 银粮 / 非法）→ 直通
    default:
      return null
  }
}
