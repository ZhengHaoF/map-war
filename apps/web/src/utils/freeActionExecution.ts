/** Bounded, live-only side effects that cannot be represented by a regular order. */
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import type { FreeActionEffect } from './aiParse'
import { normalizeCommsFrom } from './commsEntity'
import { resolveLocationId } from './locationResolver'
import { isInTruce, readRelation } from './diplomacy'
import {
  FREE_CAP_MORALE_NEG, FREE_CAP_CITY_STAT_NEG, FREE_CAP_TREASURY,
  FREE_CAP_GRANARY, COVERT_ACTION_SILVER_COST,
} from '@/data/gameConfig'

export function executeBoundedFreeEffect(eff: FreeActionEffect, narrative: string): { ok: boolean; reason?: string; telegram?: boolean } {
  const store = useGameStore()
  const actor = store.currentFaction
  if (!actor || store.gameOver?.ended) return { ok: false, reason: '未选择势力或游戏已结束' }
  let event: GameEvent | undefined
  let key = ''
  let silverCost = 0
  const clamp = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v))
  const owner = (s?: string) => s ? normalizeCommsFrom(s) as Owner : undefined
  const validFaction = (f?: Owner) => f && f !== Owner.NEUTRAL && store.activeFactions.includes(f)

  switch (eff.type) {
    case 'moraleChange':
    case 'cityStatChange': {
      if (!Number.isFinite(eff.delta) || eff.delta! >= 0) return { ok: false, reason: '自由行动增量无效' }
      const gb = eff.targetGb ? resolveLocationId(eff.targetGb) : null
      const city = gb ? store.cities[gb] : undefined
      if (!gb || !city || city.owner === actor) return { ok: false, reason: '破坏目标必须是存在的敌方城市' }
      if (readRelation(store.relations, actor, city.owner).status === 'alliance' || isInTruce(store.relations, actor, city.owner, store.currentDate)) {
        return { ok: false, reason: '不能在同盟或停战期内对该势力进行破坏' }
      }
      if (eff.type === 'moraleChange') {
        event = { type: 'moraleChange', targetGb: gb, delta: clamp(eff.delta!, FREE_CAP_MORALE_NEG) }
      } else {
        if (eff.field !== 'industry' && eff.field !== 'food' && eff.field !== 'fort') return { ok: false, reason: '不能直接修改城市等级' }
        event = { type: 'cityStatChange', targetGb: gb, field: eff.field, delta: clamp(eff.delta!, FREE_CAP_CITY_STAT_NEG) }
      }
      // Propaganda and sabotage share one target cooldown, regardless of wording/field.
      key = `covert:${gb}`
      silverCost = COVERT_ACTION_SILVER_COST
      break
    }
    case 'treasuryChange':
    case 'granaryChange': {
      const faction = owner(eff.faction)
      if (!validFaction(faction) || faction !== actor) return { ok: false, reason: '自由经济行动只能影响本方府库，赔款须经外交协商' }
      if (!Number.isFinite(eff.delta) || eff.delta! <= 0) return { ok: false, reason: '自由筹集必须是有限正数，支出走正规成本管线' }
      const cap = eff.type === 'treasuryChange' ? FREE_CAP_TREASURY : FREE_CAP_GRANARY
      event = { type: eff.type, faction: actor, delta: Math.min(cap, eff.delta!), reason: narrative.slice(0, 30) }
      key = `economy:${eff.type}`
      break
    }
    case 'relationChange': {
      const a = owner(eff.a)
      const b = owner(eff.b)
      if (!validFaction(a) || !validFaction(b) || a === b || (a !== actor && b !== actor)) return { ok: false, reason: '只能发起本方参与的外交行动' }
      if (eff.status !== 'war') return { ok: false, reason: '结盟和停战须通过外交面板协商，不能单方面修改关系' }
      if (isInTruce(store.relations, a!, b!, store.currentDate)) return { ok: false, reason: '双方尚在停战期，不能宣战' }
      event = { type: 'relationChange', a: a!, b: b!, status: 'war', note: eff.note }
      key = `war:${a === actor ? b : a}`
      break
    }
    case 'sendTelegram': {
      const target = owner(eff.to)
      if (!validFaction(target) || target === actor || !eff.content?.trim()) return { ok: false, reason: '电报目标或正文无效' }
      key = `telegram:${target}`
      break
    }
    default:
      return { ok: false, reason: '不支持的自由行动效果' }
  }
  const check = store.checkAction(actor, 1, key)
  if (!check.ok) return check
  if (store.getTreasury(actor) < silverCost) return { ok: false, reason: `破坏行动需要 ${silverCost} 万银` }
  const reserved = store.applyEvent({ type: 'actionSpent', faction: actor, amount: 1, key })
  if (!reserved.ok) return reserved
  if (silverCost) store.applyEvent({ type: 'treasuryChange', faction: actor, delta: -silverCost, reason: '宣传/破坏行动' })
  if (!event) return { ok: true, telegram: true }
  const result = store.applyEvent(event)
  if (!result.ok) {
    store.applyEvent({ type: 'actionRefunded', faction: actor, amount: 1, key })
    if (silverCost) store.applyEvent({ type: 'treasuryChange', faction: actor, delta: silverCost, reason: '失败行动退款' })
  }
  return result
}
