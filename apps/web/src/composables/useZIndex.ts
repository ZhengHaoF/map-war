import { ref } from 'vue'

/**
 * 面板层级管理器：所有 draggable GameModal 共享同一计数器，
 * 挂载时自动获取递增 z-index，调用 bringToFront() 可置顶。
 * 同时提供窗口层叠偏移量，避免新面板与已有面板位置重叠。
 */
let counter = 1000
let seq = 0

export function useZIndex(initial?: number) {
  // Fixed dialogs reserve their own layer; they must not raise the draggable
  // stack above summaries, save selectors or game-over dialogs just by mounting.
  const zIndex = ref(initial ?? counter++)

  // 窗口层叠偏移：每次调用递增，取模避免无限增长
  const slot = seq++ % 6
  const offsetX = slot * 30
  const offsetY = slot * 30

  function bringToFront() {
    zIndex.value = counter++
  }

  return { zIndex, bringToFront, offsetX, offsetY }
}
