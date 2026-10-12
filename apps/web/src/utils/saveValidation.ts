import type { GameEvent } from '@/stores/game'
import type { PendingTurnSnapshot } from '@/composables/useAgentKernel'
import { Owner } from '@/data/owners'

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const savedOrders = new Set(['arrowFly', 'radarPulse', 'orbBurst', 'battle', 'stopBattle',
  'listBattles', 'fogCover', 'capture', 'setFactionAlive', 'setCurrentDate',
  'setCurrentFaction', 'moveTroops', 'deploy', 'recruit', 'develop', 'fortify', 'rally'])
const owners = new Set<string>(Object.values(Owner))
const isoDate = (v: unknown): boolean => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const time = Date.parse(`${v}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v
}

/** Validate a resumable checkpoint without importing the runtime kernel. */
export function isPendingTurnSnapshot(value: unknown): value is PendingTurnSnapshot {
  if (!object(value) || value.version !== 1 || !owners.has(value.faction as string) ||
    !isoDate(value.baseDate) || !object(value.ownership) ||
    Object.values(value.ownership).some(owner => !owners.has(owner as string)) ||
    !['drain', 'tick', 'ai', 'execute', 'battles', 'settlement', 'date'].includes(value.stage as string) ||
    !['anchorIndex', 'turnStartIdx', 'orderCount'].every(key =>
      Number.isSafeInteger(value[key]) && (value[key] as number) >= 0) ||
    (value.turnStartIdx as number) > (value.anchorIndex as number) + 1 ||
    typeof value.anchorType !== 'string' || !Object.prototype.hasOwnProperty.call(required, value.anchorType) ||
    typeof value.battlesStarted !== 'boolean' ||
    (value.newDate !== undefined && !isoDate(value.newDate)) ||
    !Array.isArray(value.remaining)) return false
  return value.remaining.every(entry => {
    if (!object(entry) || !object(entry.order) || !object(entry.context) ||
      !savedOrders.has(entry.order.order as string)) return false
    const order = entry.order, context = entry.context
    for (const key of ['from', 'to', 'id', 'text', 'gb', 'owner', 'faction', 'reason', 'field'])
      if (order[key] !== undefined && typeof order[key] !== 'string') return false
    for (const key of ['amount', 'deployAmount', 'retreatLoss', 'resultTroops'])
      if (order[key] !== undefined && (typeof order[key] !== 'number' || !Number.isFinite(order[key]))) return false
    for (const key of ['alive', 'needsPlayerDecision'])
      if (order[key] !== undefined && typeof order[key] !== 'boolean') return false
    return (order.date === undefined || isoDate(order.date)) &&
      (context.authority === undefined || ['player', 'faction', 'system', 'debug'].includes(context.authority as string)) &&
      (context.actor === undefined || owners.has(context.actor as string)) &&
      (context.presentation === undefined || ['full', 'fast'].includes(context.presentation as string))
  })
}

/** Validate persisted data before mutating the live world; TypeScript is not a JSON validator. */
const required: Record<GameEvent['type'], { strings?: string[]; numbers?: string[]; booleans?: string[] }> = {
  scenarioStarted: { strings: ['id', 'faction'] },
  capture: { strings: ['targetGb', 'actor'] },
  moveTroops: { strings: ['fromGb', 'toGb'], numbers: ['amount'] },
  deploy: { strings: ['fromGb'], numbers: ['amount'] },
  attack: { strings: ['fromGb', 'targetGb'], numbers: ['attackerLoss', 'defenderLoss'] },
  moraleChange: { strings: ['targetGb'], numbers: ['delta'] },
  cityStatChange: { strings: ['targetGb', 'field'], numbers: ['delta'] },
  produce: { strings: ['targetGb'], numbers: ['amount'] },
  dateAdvance: { strings: ['date'] },
  setFactionAlive: { strings: ['faction'], booleans: ['alive'] },
  battleStart: { strings: ['battleId', 'fromGb', 'targetGb', 'fromName', 'toName', 'attacker', 'defender'] },
  battleEnd: { strings: ['battleId'] },
  selectFaction: { strings: ['faction', 'playerName'] },
  aiStatus: { strings: ['phase', 'status'] },
  narrative: { strings: ['playerInput', 'aiMessage'] },
  commandReceipt: { strings: ['faction', 'label'], booleans: ['ok'],
    numbers: ['spentPoints', 'spentSilver', 'spentFood', 'remainingPoints', 'remainingSilver', 'remainingFood'] },
  treasuryChange: { strings: ['faction'], numbers: ['delta'] },
  granaryChange: { strings: ['faction'], numbers: ['delta'] },
  economicTick: {},
  relationChange: { strings: ['a', 'b', 'status'] },
  pauseForPlayer: {},
  actionSpent: { strings: ['faction'], numbers: ['amount'] },
  actionRefunded: { strings: ['faction'], numbers: ['amount'] },
}
export function isSavedEvent(value: unknown): value is GameEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  if (typeof event.type !== 'string' || !Object.prototype.hasOwnProperty.call(required, event.type)) return false
  const spec = required[event.type as GameEvent['type']]
  if (spec.strings?.some(key => typeof event[key] !== 'string') ||
    spec.numbers?.some(key => typeof event[key] !== 'number' || !Number.isFinite(event[key])) ||
    spec.booleans?.some(key => typeof event[key] !== 'boolean')) return false
  if (event.type === 'economicTick') {
    if (!Array.isArray(event.entries)) return false
    if (event.entries.some(entry => !entry || typeof entry !== 'object' ||
      typeof entry.faction !== 'string' ||
      ['silverDelta', 'foodDelta', 'silverTax', 'silverUpkeep', 'foodProduce', 'foodUpkeep']
        .some(key => typeof entry[key] !== 'number' || !Number.isFinite(entry[key])))) return false
  }
  if (event.type === 'aiStatus' && (!Array.isArray(event.factions) ||
    event.factions.some(f => typeof f !== 'string'))) return false
  if (event.type === 'relationChange' && !['peace', 'war', 'alliance'].includes(event.status as string)) return false
  if (event.type === 'cityStatChange' && !['industry', 'food', 'fort', 'cityLevel'].includes(event.field as string)) return false
  if (event.type === 'narrative' && event.scope !== undefined && event.scope !== 'world-turn') return false
  if (event.type === 'dateAdvance') {
    const date = event.date as string
    const parsed = Date.parse(`${date}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== date) return false
  }
  if (event.route !== undefined && (!Array.isArray(event.route) || event.route.some(x => typeof x !== 'string'))) return false
  return true
}

export function isSaveEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const save = value as Record<string, unknown>
  if (save.version !== 1 || typeof save.playerName !== 'string' || typeof save.label !== 'string' ||
    typeof save.savedAt !== 'number' || !Number.isFinite(save.savedAt) ||
    (save.currentFaction !== null && typeof save.currentFaction !== 'string') ||
    !Array.isArray(save.eventLog) || save.eventLog.some(e => !isSavedEvent(e))) return false
  if (save.turnCount !== undefined && (!Number.isInteger(save.turnCount) || (save.turnCount as number) < 0)) return false
  if (save.fastWorldDomestic !== undefined && typeof save.fastWorldDomestic !== 'boolean') return false
  if (save.pendingTurn !== undefined && save.pendingTurn !== null) {
    if (!isPendingTurnSnapshot(save.pendingTurn)) return false
    const pending = save.pendingTurn
    const events = save.eventLog as GameEvent[]
    if (events[pending.anchorIndex]?.type !== pending.anchorType ||
      pending.faction !== save.currentFaction ||
      events.slice(pending.anchorIndex + 1).some(e => e.type === 'dateAdvance')) return false
  }
  if (save.telegrams !== undefined && (!Array.isArray(save.telegrams) ||
    save.telegrams.some(t => !t || typeof t !== 'object' ||
      ['id', 'from', 'content', 'gameDate'].some(key => typeof t[key] !== 'string') ||
      !['direct', 'world'].includes(t.channel) || typeof t.read !== 'boolean' ||
      !Number.isInteger(t.turn)))) return false
  if (save.diplomacyRecords !== undefined && (!Array.isArray(save.diplomacyRecords) ||
    save.diplomacyRecords.some(r => !r || typeof r !== 'object' || typeof r.id !== 'string' ||
      typeof r.playerFaction !== 'string' || !['negotiating', 'settled', 'abandoned'].includes(r.status) ||
      !Array.isArray(r.rounds) || r.rounds.some((round: Record<string, unknown>) =>
        !round || typeof round !== 'object' || typeof round.reply !== 'string' ||
        !['accept', 'reject', 'counter'].includes(round.stance as string))))) return false
  return true
}
