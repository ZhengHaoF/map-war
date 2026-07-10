/// <reference types="vite/client" />
/// <reference types="unplugin-icons/types/vue3" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// unplugin-icons 显式 import 形式（~icons/tabler/xxx）的虚拟模块声明，供 vue-tsc 识别
declare module '~icons/*' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, object, unknown>
  export default component
}
