import { ref } from 'vue'

/**
 * 面板层级管理器：所有 draggable GameModal 共享同一计数器，
 * 挂载时自动获取递增 z-index，调用 bringToFront() 可置顶。
 */
let counter = 1000

export function useZIndex(initial?: number) {
  const zIndex = ref(initial ?? counter++)

  function bringToFront() {
    zIndex.value = counter++
  }

  return { zIndex, bringToFront }
}
