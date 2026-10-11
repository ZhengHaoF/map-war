import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { Owner } from '@/data/owners'
import { AiWaitError } from '@/utils/aiWait'
import { computeBaseBattle } from '@/utils/battleFormula'
import { expeditionFactor } from '@/utils/economy'
import { clearLocations, registerLocations, distanceBetween } from '@/utils/locationResolver'

const mocks = vi.hoisted(() => ({ call: vi.fn<() => Promise<unknown>>() }))
vi.mock('@/utils/ai/client', () => ({ callLlm: mocks.call }))
vi.mock('@/utils/ai', async () => ({
  flavorBattles: (await vi.importActual<typeof import('@/utils/ai/battleFlavorAi')>('@/utils/ai/battleFlavorAi')).flavorBattles,
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: vi.fn<(value: unknown) => void>() }) }))
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const from = '156511500', to = '156530600'
beforeEach(() => {
  mocks.call.mockReset()
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations([
    { type: 'Feature', properties: { gb: from, name: '宜宾' }, geometry: { type: 'Point', coordinates: [104.64, 28.76] } },
    { type: 'Feature', properties: { gb: to, name: '昭通' }, geometry: { type: 'Point', coordinates: [103.72, 27.34] } },
  ], 'gb')
  store.cities[from] = { ...store.cities[from]!, troops: 20, fieldForce: 20, morale: 90 }
  store.cities[to] = { ...store.cities[to]!, troops: 20, morale: 90, fort: 5, terrain: '平原' }
  store.applyEvent({ type: 'battleStart', battleId: 'wait-front', fromGb: from, targetGb: to,
    fromName: '宜宾', toName: '昭通', attacker: Owner.SCC, defender: Owner.YUN })
})
describe('real scheduler formula after interrupted flavor', () => {
  it.each(['cancelled', 'timeout'] as const)('%s discards late AI shock but applies the base battle once', async reason => {
    let release!: (value: unknown) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const store = useGameStore()
    const base = computeBaseBattle({ atkForce: 20, defTroops: 20, atkMorale: 90, defMorale: 90,
      fort: 5, terrain: '平原', distanceFactor: expeditionFactor(distanceBetween(from, to)!) })
    const c = new AbortController()
    const waiting = vi.fn<(value: boolean) => void>()
    const result = useGameScheduler().settleActiveBattles({ signal: c.signal }, undefined, waiting)
    await flush()
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(waiting.mock.calls).toEqual([[true]])
    c.abort(new AiWaitError(reason))
    await result
    expect(waiting.mock.calls).toEqual([[true], [false]])
    expect(store.cities[from]!.fieldForce).toBe(20 - base.attackerLoss)
    expect(store.cities[to]!.troops).toBe(20 - base.defenderLoss)
    expect(store.eventLog.filter(e => e.type === 'attack')).toHaveLength(1)
    expect(store.eventLog).toContainEqual(expect.objectContaining({ type: 'aiStatus', phase: 'battleFlavor', status: 'failed', reason }))
    const before = JSON.stringify(store.eventLog)
    release({ choices: [{ message: { content: JSON.stringify({ results: [{ battleId: 'wait-front',
      events: [{ type: 'shock', side: 'attacker', magnitude: 50 }], narrative: 'late' }] }) } }] })
    await flush()
    expect(JSON.stringify(store.eventLog)).toBe(before)
    expect(store.eventLog.filter(e => e.type === 'attack')).toHaveLength(1)
  })
})
