import { ref } from 'vue'

/**
 * 面板层级管理器：所有 draggable GameModal 共享同一计数器，
 * 挂载时自动获取递增 z-index，调用 bringToFront() 可置顶。
 */
let counter = 1000

export function useZIndex(initial?: number) {
  // 若外部传了更高的初始值，对齐 counter，避免 bringToFront 压不过静态高值面板
  if (initial !== undefined && initial >= counter) {
    counter = initial + 1
  }
  const zIndex = ref(initial ?? counter++)

  function bringToFront() {
    zIndex.value = counter++
  }

  return { zIndex, bringToFront }
}
