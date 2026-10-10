/** Event-time ownership, reconstructed from the same seed used by initWorld. */
import { chinaCities } from '@/data/chinaCities'
import { Owner } from '@/data/owners'
import type { GameEvent } from '@/stores/game'

export function ownershipTimeline(events: GameEvent[]) {
  const ownership = Object.fromEntries(
    chinaCities.map((city) => [city.gb, (city.owner as Owner) ?? Owner.NEUTRAL]),
  )
  let turn = 0
  return events.map((event) => {
    const target = 'targetGb' in event ? event.targetGb : undefined
    const from = 'fromGb' in event ? event.fromGb : undefined
    const entry = {
      event,
      turn,
      targetOwner: target ? ownership[target] : undefined,
      fromOwner: from ? ownership[from] : undefined,
    }
    if (
      event.type === 'capture' &&
      ownership[event.targetGb] !== undefined &&
      Object.values(Owner).includes(event.actor)
    )
      ownership[event.targetGb] = event.actor
    if (event.type === 'dateAdvance') turn++
    return entry
  })
}
