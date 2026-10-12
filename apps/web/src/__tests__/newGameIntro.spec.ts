import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { useGameStore } from '@/stores/game'
import OnboardingView from '@/views/OnboardingView.vue'
import EpicIntro from '@/components/EpicIntro.vue'
import {
  discardNewGameIntro,
  pendingNewGameIntro,
  requestNewGameIntro,
  takeNewGameIntro,
} from '@/composables/useNewGameIntro'
import { buildIntroCast } from '@/utils/intro/introPlan'
import type { IntroMapPort, MapReadyState } from '@/utils/intro/introDirector'

beforeEach(() => discardNewGameIntro())
afterEach(() => {
  discardNewGameIntro()
  document.body.classList.remove('intro-active')
  document.body.innerHTML = ''
})

async function enter(faction: Owner, name: string) {
  const w = mount(OnboardingView)
  await w.get('[data-testid="onboarding-name"]').setValue(name)
  await w.get(`[data-testid="onboarding-faction-${faction}"]`).trigger('click')
  return w
}

const selectEvents = () => useGameStore().eventLog.filter((e) => e.type === 'selectFaction')

describe('new-game intro trigger', () => {
  it.each([Owner.SCC, Owner.KMT, Owner.JPN, Owner.TIB])(
    '“开战” as %s: exactly one selectFaction event + one intro request with the real faction',
    async (faction) => {
      const store = useGameStore()
      const w = await enter(faction, '  王五  ')
      await w.get('[data-testid="onboarding-enter"]').trigger('click')
      expect(store.currentFaction).toBe(faction)
      expect(store.playerName).toBe('王五')
      expect(selectEvents()).toHaveLength(1)
      const req = pendingNewGameIntro.value
      expect(req).not.toBeNull()
      expect(req!.faction).toBe(faction)
      expect(req!.reloadToken).toBe(store.reloadToken)
      w.unmount()
    },
  )

  it('double click / Enter during the close transition does not add a second event or request', async () => {
    const w = await enter(Owner.SCC, '甲')
    await w.get('[data-testid="onboarding-enter"]').trigger('click')
    const nonce = pendingNewGameIntro.value!.nonce
    await w.get('[data-testid="onboarding-enter"]').trigger('click')
    expect(selectEvents()).toHaveLength(1)
    expect(pendingNewGameIntro.value!.nonce).toBe(nonce)
    w.unmount()
  })

  it('request is one-shot: taking it clears it', async () => {
    requestNewGameIntro(Owner.CCP, 0)
    expect(takeNewGameIntro()?.faction).toBe(Owner.CCP)
    expect(takeNewGameIntro()).toBeNull()
  })

  it('save / load never emits an intro request', () => {
    const store = useGameStore()
    store.initWorld()
    store.setPlayer('乙', Owner.GXC)
    expect(store.save('intro-test')).toBeTruthy()
    discardNewGameIntro()
    store.initWorld()
    expect(store.load('intro-test')).toBe(true)
    expect(store.currentFaction).toBe(Owner.GXC)
    expect(pendingNewGameIntro.value).toBeNull()
  })

  it('slow map: onboarding before map mount keeps the selection (ensureWorld does not reseed)', async () => {
    const store = useGameStore()
    const w = await enter(Owner.MA, '丙')
    await w.get('[data-testid="onboarding-enter"]').trigger('click')
    // LeafletMap.onMounted 首行调用 ensureWorld()（不再 initWorld）
    expect(store.ensureWorld()).toBe(false)
    expect(store.currentFaction).toBe(Owner.MA)
    expect(store.playerName).toBe('丙')
    expect(selectEvents()).toHaveLength(1)
    w.unmount()
  })
})

function port(state: MapReadyState = 'ready') {
  let locks = 0
  const p: IntroMapPort = {
    readyState: () => state,
    whenReady: () => Promise.resolve(state === 'ready' ? { ok: true } : { ok: false, reason: '载入失败' }),
    retryLoad: () => Promise.resolve({ ok: false, reason: '仍失败' }),
    computeShots: () => ({
      wide: { cx: 0, cy: 0, z: 1 },
      national: { cx: 0, cy: 0, z: 1 },
      drift: { cx: 0, cy: 0, z: 1 },
      faction: { cx: 0, cy: 0, z: 2 },
      final: { cx: 0, cy: 0, z: 2 },
    }),
    buildLayer: () => {},
    render: () => {},
    setFinalCamera: () => {},
    destroyLayer: () => {},
    acquireLock: () => {
      locks++
      return () => void locks--
    },
    worldToken: () => 't',
  }
  return { p, locks: () => locks }
}

describe('EpicIntro component', () => {
  function castOf(faction: Owner, playerName: string) {
    const s = useGameStore()
    s.initWorld()
    return buildIntroCast({ faction, playerName, cities: s.cities, activeFactions: s.activeFactions })
  }

  it('renders the dynamic name as text (no HTML injection) and faction label', async () => {
    const { p } = port()
    const w = mount(EpicIntro, {
      props: { port: p, cast: castOf(Owner.YUN, '<img src=x>'), reduced: false, theme: 'paper' },
      attachTo: document.body,
    })
    const nameEl = document.querySelector('[data-testid="intro-player-name"]')!
    expect(nameEl.textContent).toBe('<img src=x>')
    expect(nameEl.querySelector('img')).toBeNull()
    expect(document.querySelector('[data-testid="intro-faction-label"]')!.textContent).toBe(OWNER_LABELS[Owner.YUN])
    expect(document.body.classList.contains('intro-active')).toBe(true)
    w.unmount()
    expect(document.body.classList.contains('intro-active')).toBe(false)
  })

  it('Esc skips and emits done once; lock released; body class removed', async () => {
    const { p, locks } = port()
    const w = mount(EpicIntro, {
      props: { port: p, cast: castOf(Owner.SCC, '丁'), reduced: false, theme: 'night' },
      attachTo: document.body,
    })
    expect(locks()).toBe(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('done')).toEqual([['skipped']])
    expect(locks()).toBe(0)
    expect(document.body.classList.contains('intro-active')).toBe(false)
    w.unmount()
  })

  it('skip button works and is muted by default', async () => {
    const { p } = port()
    const w = mount(EpicIntro, {
      props: { port: p, cast: castOf(Owner.KMT, '戊'), reduced: true, theme: 'paper' },
      attachTo: document.body,
    })
    const snap = (w.vm as unknown as { snapshot(): Record<string, unknown> }).snapshot()
    expect(snap.muted).toBe(true)
    ;(document.querySelector('[data-testid="intro-skip"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(w.emitted('done')).toEqual([['skipped']])
    w.unmount()
  })

  it('unmount mid-intro (route change / load) cancels: no done emitted afterwards, lock released', async () => {
    const { p, locks } = port()
    const w = mount(EpicIntro, {
      props: { port: p, cast: castOf(Owner.CCP, '己'), reduced: false, theme: 'paper' },
      attachTo: document.body,
    })
    w.unmount()
    await flushPromises()
    expect(locks()).toBe(0)
    expect(document.body.classList.contains('intro-active')).toBe(false)
  })

  it('map ready failure shows error with reachable retry / back; Esc returns to map', async () => {
    const { p, locks } = port('failed')
    const w = mount(EpicIntro, {
      props: { port: p, cast: castOf(Owner.GUI, '庚'), reduced: true, theme: 'paper' },
      attachTo: document.body,
    })
    // 减少动态闸门 1.6s：直接触发 skip → 等待 → 失败进入 error
    ;(document.querySelector('[data-testid="intro-skip"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(document.querySelector('[data-testid="intro-error"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="intro-retry"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="intro-dismiss"]')).not.toBeNull()
    expect(locks()).toBe(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.emitted('done')).toEqual([['failed']])
    w.unmount()
  })
})
