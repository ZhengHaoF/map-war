import { beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 每个测试前安装一个全新的 Pinia 实例，
// 否则任何在 setup 中调用 useGameStore() 的组件（如 App.vue）会抛
// "no active Pinia" 错误。
beforeEach(() => {
  setActivePinia(createPinia())
})
