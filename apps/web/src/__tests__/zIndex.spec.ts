import { expect, it, vi } from 'vitest'

it('keeps draggable panels below fixed dialogs despite mounting high-layer dialogs', async () => {
  vi.resetModules()
  const { useZIndex } = await import('@/composables/useZIndex')
  const command = useZIndex()
  const summary = useZIndex(2400)
  const save = useZIndex(10001)
  const gameOver = useZIndex(20000)
  command.bringToFront()
  expect(command.zIndex.value).toBeLessThan(2200)
  expect(summary.zIndex.value).toBe(2400)
  expect(save.zIndex.value).toBe(10001)
  expect(gameOver.zIndex.value).toBe(20000)
})
