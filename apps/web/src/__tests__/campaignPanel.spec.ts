import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import CampaignPanel from '@/components/CampaignPanel.vue'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { Owner } from '@/data/owners'
import { CITY_CONNECTIONS } from '@/utils/campaignRoutes'
import raw from '@/data/chinaCities.seed.json'
import { clearLocations, registerLocations } from '@/utils/locationResolver'
import { aiRequestsPending } from '@/composables/useAiChat'
import * as gameOrders from '@/utils/gameOrders'
import GameModal from '@/components/ui/GameModal.vue'

vi.mock('@/utils/troopAnimation', () => ({
  playArcAnimation: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  startBattleAnimation: vi.fn<() => { graphics: object; stop: () => void }>(() => ({ graphics: {}, stop: vi.fn<() => void>() })),
}))
function setup() {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  clearLocations()
  registerLocations(raw.filter(c => c.gb).map(c => ({
    type: 'Feature', properties: { gb: c.gb, name: c.name },
    geometry: { type: 'Point', coordinates: [104, 30] },
  })) as any, 'gb')
  const { from: a, to: b } = CITY_CONNECTIONS.find(e => e.kind === 'land')!
  store.cities[a]!.owner = Owner.SCC
  store.cities[b]!.owner = Owner.SCC
  store.cities[a]!.troops = 10
  const scheduler = useGameScheduler()
  scheduler.status.value = 'idle'
  scheduler.queue.value = []
  return { store, a, b, scheduler }
}
const stubs = { GameModal: { template: '<div><slot /></div>' } }
describe('campaign panel map draft handoff', () => {
  it('keeps final confirmation and cancellation outside the scrollable preview', () => {
    const { a, b } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    const footer = wrapper.get('.campaign-confirm')
    expect(wrapper.get('.campaign-panel').element.contains(footer.element)).toBe(false)
    expect(footer.text()).toContain('确认调兵')
    expect(footer.text()).toContain('取消')
    wrapper.unmount()
  })
  it('atomically hydrates source, action and target on first mount and reopening', async () => {
    const { a, b } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: false },
      global: { stubs },
    })
    await wrapper.setProps({ visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } })
    await nextTick()
    expect((wrapper.get('[aria-label="行军出发城"]').element as HTMLSelectElement).value).toBe(a)
    expect((wrapper.get('[aria-label="行军类型"]').element as HTMLSelectElement).value).toBe('moveTroops')
    expect((wrapper.get('[aria-label="行军目标城"]').element as HTMLSelectElement).value).toBe(b)
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true, initialDraft: { kind: 'moveTroops', sourceGb: b, targetGb: a } })
    expect((wrapper.get('[aria-label="行军目标城"]').element as HTMLSelectElement).value).toBe(a)
    await wrapper.get('[aria-label="行军类型"]').setValue('battle')
    expect((wrapper.get('[aria-label="行军目标城"]').element as HTMLSelectElement).value).toBe('')
    wrapper.unmount()
  })
  it('does not contain the obsolete in-dialog map-reselection entry buttons', async () => {
    const { a, b, scheduler } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    await wrapper.get('[aria-label="行军出发城"]').setValue(b)
    expect(wrapper.find('.campaign-reselect').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('地图重选')
    expect(scheduler.queue.value).toEqual([])
    wrapper.unmount()
  })
  it('blocks final confirmation when a queue is pending', async () => {
    const { a, b, scheduler } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    scheduler.queue.value = [{ order: 'moveTroops', from: a, to: b, amount: 1 }]
    await nextTick()
    expect(wrapper.findAll('button').find(b => b.text() === '执行中…')!.attributes('disabled')).toBeDefined()
    scheduler.queue.value = []
    wrapper.unmount()
  })
  it('blocks manual confirmation during a chat request', async () => {
    const { a, b } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    aiRequestsPending.value = 1
    await nextTick()
    expect(wrapper.findAll('button').find(b => b.text() === '执行中…')!.attributes('disabled')).toBeDefined()
    aiRequestsPending.value = 0
    wrapper.unmount()
  })
  it('rechecks changed ownership before confirmation', async () => {
    const { store, a, b, scheduler } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    store.cities = { ...store.cities, [b]: { ...store.cities[b]!, owner: Owner.KMT } }
    await nextTick()
    expect(wrapper.text()).toContain('调兵目标必须是己方城市')
    expect(wrapper.findAll('button').find(b => b.text() === '确认调兵')!.attributes('disabled')).toBeDefined()
    expect(scheduler.queue.value).toEqual([])
    wrapper.unmount()
  })
  it('rechecks a depleted treasury after the draft is opened', async () => {
    const { store, a, b, scheduler } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    while (store.getTreasury(Owner.SCC) > 0)
      store.applyEvent({ type: 'treasuryChange', faction: Owner.SCC, delta: -Math.min(50, store.getTreasury(Owner.SCC)) })
    await nextTick()
    expect(wrapper.text()).toContain('行军银粮不足')
    expect(wrapper.get('.campaign-confirm').findAll('button')[0]!.attributes('disabled')).toBeDefined()
    expect(scheduler.queue.value).toEqual([])
    wrapper.unmount()
  })
  it('submits once, and locks a successful unchanged draft until edited', async () => {
    const { a, b } = setup()
    const wrapper = mount(CampaignPanel, {
      props: { visible: true, initialDraft: { kind: 'moveTroops', sourceGb: a, targetGb: b } },
      global: { stubs },
    })
    const execute = vi.spyOn(gameOrders, 'executeOrder').mockResolvedValue({ ok: true })
    try {
      const button = wrapper.findAll('button').find(b => b.text() === '确认调兵')!
      await button.trigger('click')
      await button.trigger('click')
      await nextTick()
      expect(execute).toHaveBeenCalledTimes(1)
      expect(wrapper.text()).toContain('已执行，请重新选择')
      await wrapper.get('[aria-label="行军兵力"]').setValue('2')
      expect(wrapper.text()).not.toContain('已执行，请重新选择')
    } finally {
      execute.mockRestore()
      wrapper.unmount()
    }
  })
})
it('honors explicit non-cascading modal placement without changing defaults', () => {
  const wrapper = mount(GameModal, {
    props: { visible: true, draggable: true, initX: 180, initY: 24, cascadeOffset: false },
    global: { stubs: { Teleport: true } },
  })
  expect(wrapper.get('.modal').attributes('style')).toContain('left: 180px')
  expect(wrapper.get('.modal').attributes('style')).toContain('top: 24px')
  wrapper.unmount()
})
