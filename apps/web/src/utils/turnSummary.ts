import type { GameEvent } from '@/stores/game'
import type { Owner } from '@/data/owners'
import {
  describeEvent,
  eventBadge,
  factionName,
  isImportantEvent,
  isRoutineEvent,
  type SummaryGroup,
  SUMMARY_GROUP_ORDER,
} from './eventDescribe'
import { round1 } from './format'

export interface SummaryRow {
  badge: string
  text: string
  important: boolean
}
interface Background {
  faction: Owner
  changes: number
  rejected: number
  silver: number
  food: number
}
interface Input {
  events: GameEvent[]
  player: Owner | null
  cities: Record<string, { name: string; owner: Owner }>
  ownershipBefore?: Record<string, Owner>
}
/** View-only projection: never replace or modify the full event log. */
export function summarizeTurn({ events, player, cities, ownershipBefore = {} }: Input) {
  const groups = new Map<SummaryGroup, SummaryRow[]>()
  const background = new Map<Owner, Background>()
  const domestic = new Map<string, { gb: string; label: string; delta: number }>()
  let silverTick = 0,
    foodTick = 0,
    silverOther = 0,
    foodOther = 0
  let spent = 0,
    refunded = 0,
    economic = false
  let otherBattles = 0,
    otherCaptures = 0,
    otherEnds = 0,
    otherDiplomacy = 0
  const ownership = { ...ownershipBefore }
  const own = (gb: string) => ownership[gb] ?? cities[gb]?.owner
  const mine = (gb: string) => !!player && (own(gb) === player || cities[gb]?.owner === player)
  const bg = (faction: Owner) => {
    if (!background.has(faction))
      background.set(faction, { faction, changes: 0, rejected: 0, silver: 0, food: 0 })
    return background.get(faction)!
  }
  const add = (key: SummaryGroup, badge: string, text: string, important = false) => {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ badge, text, important })
  }
  const raw = (key: SummaryGroup, e: GameEvent) =>
    add(key, eventBadge(e), describeEvent(e, cities), isImportantEvent(e))
  for (const e of events) {
    if (e.type === 'commandReceipt') {
      if (!e.ok) {
        if (e.faction === player) add('大势', '未执行', `${e.label}：${e.reason ?? '未完成'}`, true)
        else bg(e.faction).rejected++
      }
      continue
    }
    if (isRoutineEvent(e)) continue
    if (e.type === 'economicTick') {
      for (const entry of e.entries) {
        if (entry.faction === player) {
          economic = true
          silverTick += entry.silverDelta
          foodTick += entry.foodDelta
          if (entry.arrear || entry.famine)
            add(
              '经济',
              '预警',
              `${entry.arrear ? '欠饷 ' : ''}${entry.famine ? '缺粮：驻军与外出部队可能减员' : ''}`.trim(),
              true,
            )
        } else {
          bg(entry.faction).silver += entry.silverDelta
          bg(entry.faction).food += entry.foodDelta
        }
      }
      continue
    }
    if (e.type === 'treasuryChange' || e.type === 'granaryChange') {
      if (e.faction === player) {
        economic = true
        if (e.type === 'treasuryChange') silverOther += e.delta
        else foodOther += e.delta
      } else if (e.type === 'treasuryChange') bg(e.faction).silver += e.delta
      else bg(e.faction).food += e.delta
      continue
    }
    if (e.type === 'actionSpent' || e.type === 'actionRefunded') {
      if (e.faction === player) {
        if (e.type === 'actionSpent') spent += e.amount
        else refunded += e.amount
      }
      continue
    }
    if (e.type === 'battleStart') {
      if (e.attacker === player || e.defender === player) raw('军事', e)
      else otherBattles++
      continue
    }
    if (e.type === 'capture') {
      if (e.actor === player || mine(e.targetGb)) raw('军事', e)
      else otherCaptures++
      ownership[e.targetGb] = e.actor
      continue
    }
    if (e.type === 'attack') {
      if (mine(e.fromGb) || mine(e.targetGb)) raw('军事', e)
      else otherBattles++
      continue
    }
    if (e.type === 'battleEnd') {
      // End events can lack city IDs; match a start if available in this slice.
      const start = events.find(
        (item): item is Extract<GameEvent, { type: 'battleStart' }> =>
          item.type === 'battleStart' && item.battleId === e.battleId,
      )
      const from = Object.keys(cities).find((gb) => cities[gb]?.name === e.fromName)
      const to = Object.keys(cities).find((gb) => cities[gb]?.name === e.toName)
      if (
        start?.attacker === player ||
        start?.defender === player ||
        (from && mine(from)) ||
        (to && mine(to))
      )
        raw('军事', e)
      else otherEnds++
      continue
    }
    if (e.type === 'relationChange') {
      if (e.a === player || e.b === player) raw('外交', e)
      else otherDiplomacy++
      continue
    }
    if (e.type === 'produce' || e.type === 'cityStatChange' || e.type === 'moraleChange') {
      const label =
        e.type === 'produce'
          ? '征兵'
          : e.type === 'moraleChange'
            ? '士气'
            : ({ industry: '工业', food: '粮产', fort: '工事', cityLevel: '城级' } as const)[
                e.field
              ]
      const delta = e.type === 'produce' ? e.amount : e.delta
      if (player !== null && own(e.targetGb) === player) {
        const key = `${e.targetGb}/${label}`
        const old = domestic.get(key) ?? { gb: e.targetGb, label, delta: 0 }
        old.delta += delta
        domestic.set(key, old)
      } else {
        const faction = own(e.targetGb)
        if (faction) bg(faction).changes++
      }
      continue
    }
    if (e.type === 'moveTroops' || e.type === 'deploy') {
      if (mine(e.fromGb)) raw('军事', e)
      else {
        const faction = own(e.fromGb)
        if (faction) bg(faction).changes++
      }
      continue
    }
    raw('大势', e)
  }
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${round1(n)}`
  if (economic) {
    add(
      '经济',
      '本方银',
      `净变化${signed(silverTick + silverOther)}万（经济结算${signed(silverTick)}，其他收支${signed(silverOther)}）`,
    )
    add(
      '经济',
      '本方粮',
      `净变化${signed(foodTick + foodOther)}万石（经济结算${signed(foodTick)}，其他收支${signed(foodOther)}）`,
    )
  }
  if (spent || refunded)
    add('大势', '行动点', `本轮消耗${spent}点，退还${refunded}点；净消耗${spent - refunded}点`)
  for (const item of domestic.values()) {
    if (round1(item.delta) !== 0)
      add(
        '内政',
        item.label,
        `${cities[item.gb]?.name ?? item.gb} ${item.label}净${signed(item.delta)}${item.label === '征兵' ? 'k' : ''}`,
      )
  }
  if (otherBattles || otherCaptures || otherEnds || otherDiplomacy) {
    add(
      '大势',
      '其他战局',
      `开战/交锋${otherBattles}，易主${otherCaptures}，终战${otherEnds}，外交${otherDiplomacy}；完整事件可展开查看`,
    )
  }
  return {
    groups: SUMMARY_GROUP_ORDER.filter((key) => groups.has(key)).map((key) => ({
      key,
      rows: groups.get(key)!,
    })),
    background: [...background.values()].map((item) => ({
      ...item,
      text: `${factionName(item.faction)}：例行变化${item.changes}项，拒绝${item.rejected}条；银净${signed(item.silver)}，粮净${signed(item.food)}`,
    })),
    details: events,
  }
}
