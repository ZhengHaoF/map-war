import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { SOUTHWEST_SCENARIO, BRIDGEHEAD_GB, REAR_GB } from '@/utils/scenarioObjective'
import { buildStrategyContext } from '@/utils/strategyContext'
import { nextTurnDate } from '@/utils/turnDate'

beforeEach(() => {
  const store = useGameStore()
  store.isReplaying = false
  store.initWorld()
  store.selectFaction(Owner.SCC)
})
function start() {
  return useGameStore().applyEvent({
    type: 'scenarioStarted',
    id: SOUTHWEST_SCENARIO,
    faction: Owner.SCC,
  })
}
function checkpoint() {
  const store = useGameStore()
  store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
}
function capture(occupationTurns = 2) {
  useGameStore().applyEvent({
    type: 'capture',
    targetGb: BRIDGEHEAD_GB,
    actor: Owner.SCC,
    resultTroops: 5,
    occupationTurns,
  })
}
describe('optional southwest objective', () => {
  it('starts without changing funds, troops, action points or national victory', () => {
    const store = useGameStore()
    const before = store.getSnapshot()
    expect(start().ok).toBe(true)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.scenarioStatus?.goal).toBe('夺取昭通')
    expect(store.gameOver).toBeNull()
    expect(buildStrategyContext(Owner.SCC)).toContain('可选战役目标')
    expect(buildStrategyContext(Owner.KMT)).not.toContain('可选战役目标')
  })
  it('requires three full ready turns, not the checkpoint when integration ends', () => {
    const store = useGameStore()
    start()
    capture()
    checkpoint()
    expect(store.scenarioStatus).toMatchObject({ remaining: 1, holdTurns: 0, completed: false })
    checkpoint()
    expect(store.scenarioStatus).toMatchObject({ remaining: 0, ready: true, holdTurns: 0 })
    checkpoint()
    checkpoint()
    expect(store.scenarioStatus).toMatchObject({ holdTurns: 2, completed: false })
    checkpoint()
    expect(store.scenarioStatus).toMatchObject({ holdTurns: 3, completed: true, completedTurn: 5 })
    expect(store.gameOver).toBeNull()
  })
  it('resets unfinished progress immediately if rear is lost, even when recaptured in that turn', () => {
    const store = useGameStore()
    start()
    capture(0)
    checkpoint()
    expect(store.scenarioStatus?.holdTurns).toBe(1)
    store.applyEvent({ type: 'capture', targetGb: REAR_GB, actor: Owner.YUN, occupationTurns: 0 })
    expect(store.scenarioStatus).toMatchObject({ goal: '收复并守住宜宾', holdTurns: 0 })
    store.applyEvent({ type: 'capture', targetGb: REAR_GB, actor: Owner.SCC, occupationTurns: 0 })
    checkpoint()
    expect(store.scenarioStatus?.holdTurns).toBe(1)
  })
  it('loss of target and renewed occupation reset the streak', () => {
    const store = useGameStore()
    start()
    capture(0)
    checkpoint()
    store.applyEvent({
      type: 'capture',
      targetGb: BRIDGEHEAD_GB,
      actor: Owner.YUN,
      occupationTurns: 0,
    })
    expect(store.scenarioStatus).toMatchObject({ goal: '夺取昭通', holdTurns: 0 })
    capture(2)
    checkpoint()
    expect(store.scenarioStatus?.holdTurns).toBe(0)
  })
  it('requires a supply hub, not just owning the two objective cities', () => {
    const store = useGameStore()
    store.cities = Object.fromEntries(
      Object.entries(store.cities).map(([gb, city]) => [
        gb,
        {
          ...city,
          owner: [BRIDGEHEAD_GB, REAR_GB].includes(gb) ? Owner.SCC : Owner.YUN,
        },
      ]),
    )
    start()
    checkpoint()
    expect(store.scenarioStatus).toMatchObject({ goal: '恢复昭通补给', holdTurns: 0 })
    store.applyEvent({ type: 'cityStatChange', targetGb: REAR_GB, field: 'cityLevel', delta: 1 })
    expect(store.scenarioStatus?.ready).toBe(true)
    checkpoint()
    expect(store.scenarioStatus?.holdTurns).toBe(1)
  })
  it('cannot restart or count pre-start turns; completion remains an achieved record', () => {
    const store = useGameStore()
    capture(0)
    checkpoint()
    checkpoint()
    start()
    expect(store.scenarioStatus?.holdTurns).toBe(0)
    checkpoint()
    expect(start().ok).toBe(false)
    expect(store.scenarioStatus?.holdTurns).toBe(1)
    checkpoint()
    checkpoint()
    store.applyEvent({ type: 'capture', targetGb: BRIDGEHEAD_GB, actor: Owner.YUN })
    expect(store.scenarioStatus?.completed).toBe(true)
    expect(store.scenarioStatus?.steps[2].detail).toContain('不清除完成记录')
    expect(buildStrategyContext(Owner.SCC)).toContain('完成记录保留')
    expect(buildStrategyContext(Owner.SCC)).not.toContain('失守或断供重置连续进度')
  })
  it('replays manual and automatic saves, including completion and view preference', () => {
    const store = useGameStore()
    start()
    capture(0)
    checkpoint()
    store.fastWorldDomestic = false
    store.save('objective')
    checkpoint()
    expect(store.load('objective')).toBe(true)
    expect(store.scenarioStatus?.holdTurns).toBe(1)
    expect(store.fastWorldDomestic).toBe(false)
    // LeafletMap clears replay mode after rebuilding the map in the real UI.
    store.isReplaying = false
    checkpoint()
    checkpoint()
    store.save('objective-complete')
    expect(store.load('objective-complete')).toBe(true)
    expect(store.scenarioStatus?.completed).toBe(true)
    store.isReplaying = false
    expect(store.load('auto')).toBe(true)
    expect(store.scenarioStatus).toMatchObject({ completed: true, holdTurns: 3 })
  })
  it('does not start for other factions and old saves have no campaign', () => {
    const store = useGameStore()
    store.save('old-without-campaign')
    const legacy = JSON.parse(localStorage.getItem('mapwar_save_old-without-campaign')!)
    delete legacy.fastWorldDomestic
    localStorage.setItem('mapwar_save_old-without-campaign', JSON.stringify(legacy))
    store.fastWorldDomestic = false
    start()
    expect(store.load('old-without-campaign')).toBe(true)
    expect(store.scenarioStatus).toBeNull()
    expect(store.fastWorldDomestic).toBe(true)
    store.selectFaction(Owner.KMT)
    expect(start().ok).toBe(false)
  })
})
