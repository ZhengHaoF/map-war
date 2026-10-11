import { describe, expect, it } from 'vitest'
import { useMapCommand, isMapCommandShortcut } from '@/composables/useMapCommand'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { CITY_CONNECTIONS } from '@/utils/campaignRoutes'
import { relationKey } from '@/utils/diplomacy'

function setup() {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  const edge = CITY_CONNECTIONS.find(e => e.kind === 'land')!
  const a = edge.from, b = edge.to
  store.cities[a]!.owner = Owner.SCC
  store.cities[b]!.owner = Owner.KMT
  return { store, a, b, command: useMapCommand() }
}
describe('map command UI-only draft', () => {
  it('requires a faction', () => {
    const command = useMapCommand()
    expect(command.begin('battle')).toBe(false)
    expect(command.phase.value).toBe('idle')
  })
  it('selects two cities without submitting or charging', () => {
    const { store, a, b, command } = setup()
    const before = JSON.stringify(store.$state)
    expect(command.begin('battle')).toBe(true)
    expect(command.phase.value).toBe('pickingSource')
    expect(command.pick(b)).toBe(false)
    expect(command.error.value).toContain('己方出发城')
    expect(command.pick(a)).toBe(true)
    expect(command.phase.value).toBe('pickingTarget')
    expect(command.candidates.value).toContain(b)
    expect(command.pick(b)).toBe(true)
    expect(command.draft.value).toEqual({ kind: 'battle', sourceGb: a, targetGb: b })
    expect(command.phase.value).toBe('reviewing')
    expect(command.pick(b)).toBe(false)
    command.cancel()
    expect(command.phase.value).toBe('idle')
    expect(command.candidates.value).toEqual([])
    expect(command.draft.value.sourceGb).toBe('')
    expect(JSON.stringify(store.$state)).toBe(before)
  })
  it('always restarts from source selection and clears the previous pair on mode switch', () => {
    const { a, b, command } = setup()
    command.begin('battle')
    command.pick(a)
    expect(command.phase.value).toBe('pickingTarget')
    command.pick(b)
    command.begin('moveTroops')
    expect(command.phase.value).toBe('pickingSource')
    expect(command.draft.value.sourceGb).toBe('')
    expect(command.draft.value.targetGb).toBe('')
    command.pick(a)
    expect(command.pick(b)).toBe(false)
    expect(command.error.value).toContain('己方城市')
    command.begin('battle')
    expect(command.phase.value).toBe('pickingSource')
    expect(command.error.value).toBe('')
  })
  it('supports friendly transfers, but not self-transfers', () => {
    const { store, a, b, command } = setup()
    store.cities[b]!.owner = Owner.SCC
    command.begin('moveTroops')
    command.pick(a)
    expect(command.candidates.value).toContain(b)
    expect(command.pick(a)).toBe(false)
    expect(command.pick(b)).toBe(true)
    expect(command.draft.value.kind).toBe('moveTroops')
    command.begin('battle')
    command.pick(a)
    expect(command.pick(b)).toBe(false)
  })
  it('excludes alliance and truce endpoints but permits them after expiry', () => {
    const { store, a, b, command } = setup()
    const key = relationKey(Owner.SCC, Owner.KMT)
    command.begin('battle')
    command.pick(a)
    store.relations[key] = { status: 'alliance' }
    expect(command.candidates.value).not.toContain(b)
    expect(command.pick(b)).toBe(false)
    store.relations[key] = { status: 'peace', truceUntil: '2030-01-01' }
    expect(command.targetReason(b)).toContain('停战')
    store.relations[key] = { status: 'peace', truceUntil: '1930-01-01' }
    expect(command.pick(b)).toBe(true)
  })
  it('validates ownership again after entering target mode', () => {
    const { store, a, b, command } = setup()
    command.begin('battle')
    command.pick(a)
    store.cities[a]!.owner = Owner.KMT
    expect(command.candidates.value).toEqual([])
    expect(command.pick(b)).toBe(false)
    expect(command.error.value).toContain('出发城已不可用')
  })
  it('does not confuse reachable targets with affordable or safe attacks', () => {
    const { store, a, b, command } = setup()
    store.cities[a]!.troops = 0
    store.cities[b]!.troops = 1000
    command.begin('battle')
    command.pick(a)
    expect(command.candidates.value).toContain(b)
    expect(command.pick(b)).toBe(true)
  })
  it('rejects disconnected targets', () => {
    const { store, a, command } = setup()
    command.begin('battle')
    command.pick(a)
    const unreachable = Object.keys(store.cities).find(gb => command.targetReason(gb).includes('路线'))!
    expect(unreachable).toBeTruthy()
    expect(command.pick(unreachable)).toBe(false)
    expect(command.error.value).toContain('路线')
  })
  it('the first step contains only owned cities and never includes an enemy', () => {
    const { store, a, b, command } = setup()
    command.begin('battle')
    expect(command.candidates.value).toContain(a)
    expect(command.candidates.value).not.toContain(b)
    expect(command.candidates.value.every(gb => store.cities[gb]!.owner === Owner.SCC)).toBe(true)
    expect(command.pick(b)).toBe(false)
    expect(command.phase.value).toBe('pickingSource')
    expect(command.draft.value).toEqual({ kind: 'battle', sourceGb: '', targetGb: '' })
  })
  it('source reselection starts two fresh steps instead of reusing the old city', () => {
    const { a, command } = setup()
    command.begin('battle')
    command.pick(a)
    command.begin('battle')
    expect(command.phase.value).toBe('pickingSource')
    expect(command.draft.value.sourceGb).toBe('')
    expect(command.draft.value.targetGb).toBe('')
  })
  it('cancel from either picking stage removes all candidate highlights and draft IDs', () => {
    const { a, command } = setup()
    for (const withSource of [false, true]) {
      command.begin('moveTroops')
      if (withSource) command.pick(a)
      command.cancel()
      expect(command.candidates.value).toEqual([])
      expect(command.draft.value.sourceGb).toBe('')
      expect(command.phase.value).toBe('idle')
      expect(command.pick(a)).toBe(false)
    }
  })
})
describe('map keyboard exclusions', () => {
  it.each(['input', 'textarea', 'select', 'div'])('ignores editing target %s', tag => {
    const el = document.createElement(tag)
    if (tag === 'div') el.setAttribute('contenteditable', 'true')
    const event = new KeyboardEvent('keydown', { key: 'a' })
    Object.defineProperty(event, 'target', { value: el })
    expect(isMapCommandShortcut(event)).toBe(false)
  })
  it.each([{ isComposing: true }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])('ignores reserved input %j', options => {
    expect(isMapCommandShortcut(new KeyboardEvent('keydown', { key: 'm', ...options }))).toBe(false)
  })
  it('accepts plain A/M keyboard input', () => {
    expect(isMapCommandShortcut(new KeyboardEvent('keydown', { key: 'A' }))).toBe(true)
  })
})
