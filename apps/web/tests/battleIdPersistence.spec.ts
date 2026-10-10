import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore, type GameEvent } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTION_NODES } from '@/utils/campaignRoutes'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { init, resetBattleRuntime, executeOrder } from '@/utils/gameOrders'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { checkMoraleCollapse } from '@/utils/battleFormula'
import { nextTurnDate } from '@/utils/turnDate'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playScoutAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => object>(() => ({ graphics: {}, stop: () => {} })),
  playCaptureAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  playDevelopAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))
vi.mock('@/utils/ai', () => ({ flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}) }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<() => void>() }) }))
const from = '156511500', to = '156530600'
const attack = () => executeOrder({ order: 'battle', from, to, deployAmount: 3 })
const retreat = (id: string) => executeOrder({ order: 'stopBattle', id, reason: 'retreat' })
beforeEach(() => {
  const store = useGameStore()
  store.isReplaying = false
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(Object.entries(CITY_CONNECTION_NODES).map(([gb, node]) => ({
    type: 'Feature', properties: { gb, name: store.cities[gb]!.name },
    geometry: { type: 'Point', coordinates: [node.lng, node.lat] },
  })), 'gb')
  resetBattleRuntime()
  init({} as never, undefined, {} as never)
  localStorage.clear()
})
describe('historical battle IDs survive normal saves', () => {
  it('does not reuse an ended battle after loading an empty active list', async () => {
    expect((await attack()).ok).toBe(true)
    expect((await retreat('battle_1')).ok).toBe(true)
    const store = useGameStore(), history = JSON.parse(JSON.stringify(store.eventLog))
    expect(store.battles).toHaveLength(0)
    expect(store.save('ended')).toBe(true)
    expect(store.load('ended')).toBe(true)
    store.isReplaying = false
    expect(store.eventLog).toEqual(history)
    expect(await attack()).toMatchObject({ ok: true, id: 'battle_2' })
  })
  it('runtime reset without loading also respects ended history', async () => {
    await attack()
    await retreat('battle_1')
    resetBattleRuntime()
    expect(await attack()).toMatchObject({ ok: true, id: 'battle_2' })
  })
  it('uses historical end events even when the corresponding start is missing', async () => {
    const store = useGameStore()
    store.applyEvent({ type: 'battleEnd', battleId: 'battle_41', reason: 'peace' })
    expect(await attack()).toMatchObject({ ok: true, id: 'battle_42' })
  })
  it('does not alter reused legacy IDs or attempt to rewrite old results', async () => {
    const store = useGameStore()
    store.applyEvent({ type: 'battleEnd', battleId: 'battle_7', reason: 'peace' })
    store.applyEvent({ type: 'battleEnd', battleId: 'battle_7', reason: 'retreat' })
    store.applyEvent({ type: 'battleEnd', battleId: 'legacy-name', reason: 'peace' })
    const history = JSON.parse(JSON.stringify(store.eventLog)) as GameEvent[]
    store.save('legacy')
    expect(store.load('legacy')).toBe(true)
    store.isReplaying = false
    expect(store.eventLog).toEqual(history)
    expect(await attack()).toMatchObject({ ok: true, id: 'battle_8' })
    expect(store.eventLog.slice(0, history.length)).toEqual(history)
  })
  it('includes active IDs not present in an incomplete legacy event log', async () => {
    const store = useGameStore()
    store.battles.push({
      id: 'battle_51', from: 'legacy-source', to: 'legacy-target',
      fromName: '旧来源', toName: '旧目标', active: false,
      attacker: Owner.SCC, defender: Owner.YUN, turns: 0,
      totalAttackerLoss: 0, totalDefenderLoss: 0, lastAttackerLoss: 0, lastDefenderLoss: 0,
    })
    expect(await attack()).toMatchObject({ ok: true, id: 'battle_52' })
  })
  it('matches subsequent IDs, collapse inputs and actual settlements with and without loading', async () => {
    const store = useGameStore()
    await attack()
    await retreat('battle_1')
    store.save('fork')
    async function continueGame() {
      const result = await attack()
      expect(result).toMatchObject({ ok: true, id: 'battle_2' })
      const seeds: unknown[] = []
      for (let turn = 0; turn < 4; turn++) {
        const battle = store.battles.find(b => b.active)
        if (battle) {
          const args = {
            battleId: battle.id, turns: battle.turns + 1,
            atkMorale: store.cities[battle.from]!.morale,
            defMorale: store.cities[battle.to]!.morale,
          }
          seeds.push({ args, collapse: checkMoraleCollapse(args) })
        }
        await useGameScheduler().settleActiveBattles()
        store.applyEvent({ type: 'dateAdvance', date: nextTurnDate(store.currentDate) })
      }
      return JSON.parse(JSON.stringify({ seeds, snapshot: store.getSnapshot(), events: store.eventLog }))
    }
    const uninterrupted = await continueGame()
    expect(store.load('fork')).toBe(true)
    store.isReplaying = false
    expect(await continueGame()).toEqual(uninterrupted)
  })
})
