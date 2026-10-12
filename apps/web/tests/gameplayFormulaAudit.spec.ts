/** Analysis fixture, not a new gameplay rule or a live-model test. */
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { Owner } from '@/data/owners'
import { computeBaseBattle } from '@/utils/battleFormula'
import { executeOrder } from '@/utils/gameOrders'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
vi.mock('@/utils/ai', () => ({
  flavorBattles: vi.fn<() => Promise<object>>().mockResolvedValue({}),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: vi.fn<() => void>() }),
}))
describe('controlled actual-engine gameplay audit', () => {
  it.skipIf(!process.env.MAPWAR_GAMEPLAY_AUDIT_OUT)('exports controlled small-army cases', async () => {
    const rows: Record<string, unknown>[] = []
    for (const id of ['battle_1', 'battle_2', 'battle_9'])
      for (const terrain of ['PLAIN', 'MOUNTAIN'])
        for (const fort of [20, 60])
          for (const force of [5, 10, 15, 30, 60]) {
            setActivePinia(createPinia())
            const store = useGameStore()
            store.initWorld()
            store.selectFaction(Owner.SCC)
            const from = '156511500', to = '156530600'
            store.cities[from] = { ...store.cities[from]!, owner: Owner.SCC,
              troops: 10, fieldForce: force, morale: 70 }
            store.cities[to] = { ...store.cities[to]!, owner: Owner.YUN,
              troops: 5, morale: 55, fort, terrain }
            expect(store.applyEvent({
              type: 'battleStart', battleId: id, fromGb: from, targetGb: to,
              fromName: '宜宾', toName: '昭通', attacker: Owner.SCC, defender: Owner.YUN,
              marchDistanceKm: 0,
            }).ok).toBe(true)
            const first = computeBaseBattle({
              atkForce: force, defTroops: 5, atkMorale: 70, defMorale: 55,
              fort, terrain, distanceFactor: 1,
            })
            let rounds = 0
            while (store.battles.some(b => b.id === id && b.active) && rounds < 40) {
              await useGameScheduler().settleActiveBattles()
              rounds++
            }
            const losses = store.eventLog.filter(e => e.type === 'attack')
            const end = store.eventLog.find(e => e.type === 'battleEnd')
            rows.push({
              id, force, defender: 5, terrain, fort, rounds,
              firstAttackerLoss: first.attackerLoss, firstDefenderLoss: first.defenderLoss,
              attackerLoss: losses.reduce((s, e) => s + e.attackerLoss, 0),
              defenderLoss: losses.reduce((s, e) => s + e.defenderLoss, 0),
              end: end?.type === 'battleEnd' ? end.reason : null,
              captured: store.cities[to]!.owner === Owner.SCC,
            })
            expect(Number.isFinite(rounds)).toBe(true)
          }
    // Verify the suggested rally amount through the actual command boundary.
    setActivePinia(createPinia())
    const store = useGameStore()
    store.initWorld()
    store.selectFaction(Owner.SCC)
    const gb = '156511500'
    clearLocations()
    registerLocations([{ type: 'Feature', geometry: null,
      properties: { gb, name: '宜宾市' } }], 'gb')
    const silver = store.getTreasury(Owner.SCC), morale = store.cities[gb]!.morale
    const result = await executeOrder({ order: 'rally', gb, amount: 20 })
    expect(result.ok).toBe(true)
    clearLocations()
    const rallyProbe = { requested: 20, accepted: result.ok,
      moraleGain: store.cities[gb]!.morale - morale,
      silverCost: Math.round((silver - store.getTreasury(Owner.SCC)) * 10) / 10 }
    const folder = resolve(process.env.MAPWAR_GAMEPLAY_AUDIT_OUT!)
    const sourceHashes = Object.fromEntries([
      'src/stores/game.ts', 'src/composables/useGameScheduler.ts',
      'src/utils/battleFormula.ts', 'src/data/gameConfig.ts',
    ].map(file => [file, createHash('sha256').update(readFileSync(resolve(file))).digest('hex')]))
    mkdirSync(folder, { recursive: true })
    writeFileSync(`${folder}/actual-engine-cases.json`, JSON.stringify({
      sourceHashes,
      method: 'Real store + scheduler + formula. Fixed morale 70/55, defender 5k, distance 0, legacy supply semantics; no AI flavor, reinforcement, rally, economy or date advance. Battle IDs are deterministic seed inputs, not independent samples.',
      rows, rallyProbe,
    }, null, 2))
    // eslint-disable-next-line no-console
    console.log(`Exported ${rows.length} controlled battle cases and a separate rally probe to ${folder}`)
  }, 120000)
})
