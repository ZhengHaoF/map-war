import { effectScope } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { useAiOrchestrator } from '@/composables/useAiOrchestrator'
import { useAiChat, aiRequestsPending, aiEffectsPending } from '@/composables/useAiChat'
import { useSaveGame } from '@/composables/useSaveGame'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { useGameScheduler } from '@/composables/useGameScheduler'
import PlayerAiPanel from '@/components/PlayerAiPanel.vue'
import AdvisorPanel from '@/components/AdvisorPanel.vue'

const mocks = vi.hoisted(() => ({ toast: vi.fn<(value: unknown) => void>() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: mocks.toast }) }))
const raw = (value: unknown) => ({ choices: [{ message: { content: JSON.stringify(value) } }] })
const response = (value: unknown) => new Response(JSON.stringify(raw(value)), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})
const plan = { msg: '旧计划不应保留', results: [], suggestions: ['旧建议'] }
const stubs = { GameModal: { template: '<div><slot /></div>' }, WorldProgressBanner: true }
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  const store = useGameStore()
  store.initWorld()
  store.selectFaction(Owner.SCC)
  store.save('baseline')
  const scheduler = useGameScheduler()
  scheduler.queue.value = []
  scheduler.status.value = 'idle'
  useAgentKernel().loading.value = false
  aiEffectsPending.value = 0
  mocks.toast.mockClear()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.unstubAllGlobals()
})
function orchestrator(mode: 'user' | 'advisor' = 'user') {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(() => useAiOrchestrator(mode))!
}
describe('load boundaries', () => {
  it('clears command history, suggestions and draft, and excludes them from the next model prompt', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(plan))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(PlayerAiPanel, { props: { visible: true }, global: { stubs } })
    await wrapper.get('textarea').setValue('旧指令')
    await wrapper.findAll('button').find(b => b.text() === '发送')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('旧计划不应保留')
    expect(wrapper.text()).toContain('旧建议')
    await wrapper.get('textarea').setValue('待发草稿')
    expect(useSaveGame().loadGame('baseline')).toBe(true)
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧计划不应保留')
    expect(wrapper.text()).not.toContain('旧建议')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.get('textarea').setValue('新指令')
    await wrapper.findAll('button').find(b => b.text() === '发送')!.trigger('click')
    await flushPromises()
    const body = JSON.parse(fetch.mock.calls[1]![1]!.body as string)
    expect(JSON.stringify(body)).not.toMatch(/旧指令|旧计划|旧建议|待发草稿/)
    wrapper.unmount()
  })
  it('clears advisor reply and suggestions as well', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      response({ reply: '旧顾问答复', suggestions: ['旧顾问建议'] })))
    const wrapper = mount(AdvisorPanel, { props: { visible: true }, global: { stubs } })
    await wrapper.get('textarea').setValue('旧问题')
    await wrapper.findAll('button').find(b => b.text() === '咨询')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('旧顾问答复')
    useSaveGame().loadGame('baseline')
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧顾问答复')
    expect(wrapper.text()).not.toContain('旧顾问建议')
    wrapper.unmount()
  })
  it.each(['user', 'advisor'] as const)('invalidates an in-flight %s response even if transport ignores abort', async mode => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      new Promise(r => { resolve = r })))
    const ai = orchestrator(mode)
    ai.userMessage.value = '旧请求'
    const pending = ai.runSend()
    const store = useGameStore()
    expect(useSaveGame().loadGame('baseline')).toBe(true)
    const log = [...store.eventLog]
    resolve(response(mode === 'advisor' ? { reply: '晚到顾问', suggestions: ['晚到建议'] }
      : { msg: '晚到自由效果', freeAction: { narrative: '错误效果', success: true,
        effects: [{ type: 'treasuryChange', delta: 10 }] } }))
    await pending
    expect(store.eventLog).toEqual(log)
    expect(ai.parsed.value).toBeNull()
    expect(ai.aiMessage.value).toBeNull()
    expect(ai.freeActionResult.value).toBeNull()
    expect(ai.advisorResponse.value).toBeNull()
    expect(ai.userMessage.value).toBe('')
    expect(aiRequestsPending.value).toBe(0)
  })
  it('a late old response cannot overwrite a newer request or its loading state', async () => {
    const resolves: ((value: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      new Promise(r => resolves.push(r))))
    const ai = useAiChat()
    const old = ai.send({ messages: [] })
    ai.reset()
    const fresh = ai.send({ messages: [] })
    resolves[0]!(response(plan))
    await old
    expect(ai.loading.value).toBe(true)
    expect(ai.response.value).toBeNull()
    resolves[1]!(response({ reply: 'new' }))
    await fresh
    expect(ai.response.value).toEqual(raw({ reply: 'new' }))
    expect(ai.loading.value).toBe(false)
    expect(aiRequestsPending.value).toBe(0)
  })
  it('an aborted request releases global busy accounting', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation((_url, options) =>
      new Promise((_resolve, reject) => options?.signal?.addEventListener('abort',
        () => reject(new DOMException('aborted', 'AbortError'))))))
    const ai = orchestrator()
    ai.userMessage.value = '等待中'
    const pending = ai.runSend()
    useSaveGame().loadGame('baseline')
    await pending
    expect(ai.loading.value).toBe(false)
    expect(ai.error.value).toBeNull()
    expect(aiRequestsPending.value).toBe(0)
  })
  it.each(['world', 'scheduler', 'freeEffects'] as const)('blocks load while %s is mutating, without touching world or chat', kind => {
    const store = useGameStore(), ai = orchestrator()
    ai.userMessage.value = '保留草稿'
    const before = store.getSnapshot(), token = store.reloadToken
    if (kind === 'world') useAgentKernel().loading.value = true
    if (kind === 'scheduler') useGameScheduler().status.value = 'running'
    if (kind === 'freeEffects') aiEffectsPending.value = 1
    expect(useSaveGame().loadGame('baseline')).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
    expect(store.reloadToken).toBe(token)
    expect(ai.userMessage.value).toBe('保留草稿')
    expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: '暂不能读档' }))
  })
  it('successful load removes pending scheduler drafts, receipts and summary', () => {
    const scheduler = useGameScheduler()
    scheduler.queue.value = [{ order: 'recruit', gb: '156511500', amount: 1 }]
    scheduler.executionResults.value = [{ order: scheduler.queue.value[0]!, ok: true }]
    const kernel = useAgentKernel()
    kernel.turnSummary.value = [{ type: 'narrative', playerInput: '', aiMessage: 'old' }]
    expect(useSaveGame().loadGame('baseline')).toBe(true)
    expect(scheduler.queue.value).toEqual([])
    expect(scheduler.executionResults.value).toEqual([])
    expect(kernel.turnSummary.value).toBeNull()
  })
  it('failed load preserves conversation and draft', () => {
    const ai = orchestrator()
    ai.userMessage.value = '保留草稿'
    ai.playerSuggestions.value = ['保留建议']
    const store = useGameStore(), token = store.reloadToken
    expect(useSaveGame().loadGame('does-not-exist')).toBe(false)
    expect(store.reloadToken).toBe(token)
    expect(ai.userMessage.value).toBe('保留草稿')
    expect(ai.playerSuggestions.value).toEqual(['保留建议'])
  })
})
