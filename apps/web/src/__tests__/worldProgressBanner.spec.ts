import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WorldProgressBanner from '@/components/WorldProgressBanner.vue'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { Owner } from '@/data/owners'
import type { Ref } from 'vue'

const mocks = vi.hoisted(() => ({ stop: vi.fn<() => boolean>(() => true) }))
vi.mock('@/composables/useAgentKernel', async () => {
  const { ref } = await import('vue')
  const state = {
    loading: ref(true), phase: ref('ai'), progress: ref('政权 AI 决策中…'),
    worldAiTasks: ref([]), aiWaiting: ref(true), waitDeadlineAt: ref(180000),
    waitRemainingMs: ref(125000), waitStopReason: ref(null), canStopAiWaiting: ref(true),
    stopAiWaiting: mocks.stop,
  }
  return { useAgentKernel: () => state }
})
vi.mock('@/composables/useGameScheduler', async () => {
  const { ref } = await import('vue')
  return { useGameScheduler: () => ({ queue: ref([]), status: ref('idle') }) }
})
beforeEach(() => {
  mocks.stop.mockClear()
  const kernel = useAgentKernel()
  kernel.loading.value = true
  kernel.aiWaiting.value = true
  ;(kernel.canStopAiWaiting as Ref<boolean>).value = true
  kernel.waitStopReason.value = null
  kernel.waitRemainingMs.value = 125000
  kernel.worldAiTasks.value = [
    { id: 'faction:YUN', label: '滇系', phase: 'faction', factions: [Owner.YUN],
      state: 'retrying', attempt: 2, maxAttempts: 3, retryDelayMs: 1000 },
    { id: 'batch', label: '世界批量（2 家）', phase: 'batch', factions: [Owner.KMT, Owner.NEA],
      state: 'empty', attempt: 1, maxAttempts: 3 },
  ]
})
describe('visible world wait controls', () => {
  it('shows actual retry, valid empty, shared batch factions, count and deadline', () => {
    const wrapper = mount(WorldProgressBanner)
    expect(wrapper.text()).toContain('AI 回复 1/2 项完成')
    expect(wrapper.text()).toContain('等待重试 2/3')
    expect(wrapper.text()).toContain('截止剩余 125 秒')
    expect(wrapper.text()).toContain('有效回复，无行动计划')
    expect(wrapper.text()).toContain('国民政府、东北军（共享一份批量请求）')
    expect(wrapper.text()).toContain('经济与已执行动作不回滚')
    wrapper.unmount()
  })
  it('invokes the stop-wait action from its visible button', async () => {
    const wrapper = mount(WorldProgressBanner)
    await wrapper.get('.wpb-stop-area button').trigger('click')
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('disables cancellation during local execution and explains the boundary', () => {
    const kernel = useAgentKernel()
    kernel.aiWaiting.value = false
    ;(kernel.canStopAiWaiting as Ref<boolean>).value = false
    const wrapper = mount(WorldProgressBanner)
    expect(wrapper.get('.wpb-stop-area button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('本地执行／日期演出期间不能中断')
    wrapper.unmount()
  })
  it.each(['timeout', 'cancelled'] as const)('shows %s as degraded rather than valid inactivity', reason => {
    const kernel = useAgentKernel()
    kernel.waitStopReason.value = reason
    ;(kernel.canStopAiWaiting as Ref<boolean>).value = false
    kernel.worldAiTasks.value[0] = { ...kernel.worldAiTasks.value[0]!, state: 'failed', reason }
    const wrapper = mount(WorldProgressBanner)
    expect(wrapper.get('.wpb-tasks li').text()).toContain(reason === 'timeout' ? '等待超时' : '已停止等待')
    expect(wrapper.get('.wpb-stop-area button').text()).toBe('正在按已有结果结算')
    expect(wrapper.get('.wpb-stop-area button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('custom progress consumers do not leak global world tasks or stop controls', () => {
    const wrapper = mount(WorldProgressBanner, { props: { loading: true, mainText: '自定义等待', subText: '另一个任务' } })
    expect(wrapper.text()).toContain('自定义等待')
    expect(wrapper.find('.wpb-tasks').exists()).toBe(false)
    expect(wrapper.find('.wpb-stop-area').exists()).toBe(false)
    wrapper.unmount()
  })
})
