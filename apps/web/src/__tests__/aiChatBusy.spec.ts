import { afterEach, expect, it, vi } from 'vitest'
import { aiRequestsPending, useAiChat } from '@/composables/useAiChat'

afterEach(() => {
  vi.unstubAllGlobals()
})
it('tracks concurrent chat instances until each request settles', async () => {
  const resolves: ((value: Response) => void)[] = []
  vi.stubGlobal('fetch', vi.fn<() => Promise<Response>>(() => new Promise(resolve => resolves.push(resolve))))
  const one = useAiChat(), two = useAiChat()
  const first = one.send({ messages: [] }), second = two.send({ messages: [] })
  expect(aiRequestsPending.value).toBe(2)
  resolves[0]!(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await first
  expect(aiRequestsPending.value).toBe(1)
  resolves[1]!(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }))
  await second
  expect(aiRequestsPending.value).toBe(0)
  expect(two.error.value).toBeTruthy()
})
it('releases the shared busy signal after a network exception', async () => {
  vi.stubGlobal('fetch', vi.fn<() => Promise<Response>>().mockRejectedValue(new Error('offline')))
  await useAiChat().send({ messages: [] })
  expect(aiRequestsPending.value).toBe(0)
})
