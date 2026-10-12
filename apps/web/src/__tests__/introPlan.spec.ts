import { beforeEach, describe, expect, it } from 'vitest'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { useGameStore } from '@/stores/game'
import { CITY_CONNECTIONS } from '@/utils/campaignRoutes'
import {
  INTRO_FACTION_ORDER,
  PLAYER_NAME_FALLBACK,
  buildIntroCast,
  computeIntroShots,
  connectionNeighbours,
  displayPlayerName,
  resolveFocusCity,
  shotToCamera,
  type Box,
} from '@/utils/intro/introPlan'

const all = connectionNeighbours(CITY_CONNECTIONS)
const land = connectionNeighbours(CITY_CONNECTIONS, 'land')

function castFor(faction: Owner, playerName = '测试') {
  const s = useGameStore()
  return buildIntroCast({
    faction,
    playerName,
    cities: s.cities,
    activeFactions: s.activeFactions,
    neighboursOf: all,
    landNeighboursOf: land,
  })
}

describe('intro cast is built from the real store, for every faction', () => {
  beforeEach(() => {
    useGameStore().initWorld()
  })

  it.each(INTRO_FACTION_ORDER.map((f) => [f]))('%s: label, seal, focus owned by the faction, cluster ⊆ own', (f) => {
    const s = useGameStore()
    const cast = castFor(f)
    expect(cast.faction).toBe(f)
    expect(cast.factionLabel).toBe(OWNER_LABELS[f])
    expect(cast.sealChar).toBe(Array.from(OWNER_LABELS[f])[0])
    expect(cast.focus).not.toBeNull()
    expect(s.cities[cast.focus!.gb]!.owner).toBe(f)
    expect(cast.clusterGbs).toContain(cast.focus!.gb)
    for (const gb of cast.clusterGbs) expect(s.cities[gb]!.owner).toBe(f)
    expect(cast.roster.map((r) => r.id)).toContain(f)
    expect(cast.neighbors.length).toBeLessThanOrEqual(4)
    expect(cast.neighbors.map((n) => n.id)).not.toContain(f)
    expect(cast.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('non-SCC factions are not hard-coded to the demo: focus differs per faction', () => {
    const foci = new Set(INTRO_FACTION_ORDER.map((f) => castFor(f).focus!.gb))
    expect(foci.size).toBe(INTRO_FACTION_ORDER.length)
    expect(castFor(Owner.SCC).focus!.gb).toBe('156510100') // 成都（重庆属国民政府）
    expect(castFor(Owner.CCP).focus!.gb).toBe('156360700') // 赣州（瑞金不在数据中）
    expect(castFor(Owner.KMT).focus!.gb).toBe('156320100')
  })

  it('JPN main cluster excludes sea-only Taiwan', () => {
    const cast = castFor(Owner.JPN)
    expect(cast.ownGbs).toContain('156710000')
    expect(cast.clusterGbs).not.toContain('156710000')
  })

  it('focus follows runtime ownership: captured capital falls back to the strongest own city', () => {
    const s = useGameStore()
    const cities = { ...s.cities, '156510100': { ...s.cities['156510100']!, owner: Owner.KMT } }
    const focus = resolveFocusCity(Owner.SCC, cities)
    expect(focus).not.toBeNull()
    expect(focus!.gb).not.toBe('156510100')
    expect(focus!.owner).toBe(Owner.SCC)
  })

  it('unregistered candidate is skipped in favour of a registered own city', () => {
    const s = useGameStore()
    const focus = resolveFocusCity(Owner.SCC, s.cities, (gb) => gb !== '156510100')
    expect(focus!.gb).not.toBe('156510100')
    expect(focus!.owner).toBe(Owner.SCC)
  })

  it('eliminated factions are not shown in the roster', () => {
    const s = useGameStore()
    const cast = buildIntroCast({
      faction: Owner.SCC,
      playerName: 'a',
      cities: s.cities,
      activeFactions: s.activeFactions.filter((f) => f !== Owner.XJ),
    })
    expect(cast.roster.map((r) => r.id)).not.toContain(Owner.XJ)
  })
})

describe('player name is plain text', () => {
  it('trims, truncates by code point to 12 and falls back', () => {
    expect(displayPlayerName('  张三  ')).toBe('张三')
    expect(displayPlayerName('')).toBe(PLAYER_NAME_FALLBACK)
    expect(displayPlayerName('   ')).toBe(PLAYER_NAME_FALLBACK)
    expect(displayPlayerName(undefined)).toBe(PLAYER_NAME_FALLBACK)
    expect(Array.from(displayPlayerName('😀'.repeat(20)))).toHaveLength(12)
  })
  it('HTML-looking input is kept verbatim (escaped by Vue text interpolation, never v-html)', () => {
    expect(displayPlayerName('<img src=x onerror=1>')).toBe('<img src=x o')
    expect(displayPlayerName('<b>王</b>')).toBe('<b>王</b>')
  })
})

describe('shots', () => {
  const vp = { width: 1280, height: 800 }
  const boxes = new Map<string, Box>([
    ['a', { minX: 100, minY: 100, maxX: 200, maxY: 160 }],
    ['b', { minX: 200, minY: 120, maxX: 260, maxY: 200 }],
    ['island', { minX: 500, minY: 900, maxX: 510, maxY: 910 }],
  ])
  const shots = computeIntroShots({
    viewport: vp,
    boxes,
    clusterGbs: ['a', 'b'],
    ownGbs: ['a', 'b', 'island'],
    unitsPerDegree: 20,
    southCutY: 800,
    zoomMin: 0.5,
    zoomMax: 8,
  })!

  it('zoom is clamped and the faction shot frames the cluster', () => {
    expect(shots).not.toBeNull()
    for (const s of Object.values(shots)) {
      expect(s.z).toBeGreaterThanOrEqual(0.5)
      expect(s.z).toBeLessThanOrEqual(8)
    }
    expect(shots.faction.z).toBeGreaterThanOrEqual(shots.wide.z)
    expect(shots.wide.z).toBeLessThanOrEqual(shots.national.z)
    expect(shots.faction.cx).toBeGreaterThan(100)
    expect(shots.faction.cx).toBeLessThan(260)
  })

  it('shotToCamera centres the shot on screen', () => {
    const cam = shotToCamera(shots.final, vp)
    expect(cam.x + shots.final.cx * cam.scale).toBeCloseTo(vp.width / 2)
    expect(cam.y + shots.final.cy * cam.scale).toBeCloseTo(vp.height / 2)
  })
})
