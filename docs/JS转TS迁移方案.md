# JS 转 TS 迁移方案

> 版本: 1.0 | 日期: 2026-07-09 | 范围: `src/` 下所有 `.js` 文件及 Vue SFC（不含 `map-war-server/`）

---

## 一、迁移总览

### 1.1 当前状态

| 层级 | 文件数 | 已 TS | 待迁移 |
|------|--------|-------|--------|
| data（数据层） | 4 | 4 ✅ | 0 |
| utils（工具层） | 3 | 0 | 3 |
| stores（状态管理） | 1 | 0 | 1 |
| router（路由） | 1 | 0 | 1 |
| components/ui（UI 组件） | 5 | 0 | 5 (Vue SFC) |
| components（核心组件） | 1 | 0 | 1 (Vue SFC) |
| views（视图） | 1 | 0 | 1 (Vue SFC) |
| 入口层 | 2 | 0 | 2 |
| 测试 | 1 | 0 | 1 |
| **合计** | **19** | **4** | **15** |

### 1.2 迁移原则

1. **自底向上**：从无依赖的叶子节点开始，逐层向上迁移
2. **一次一个文件**：每迁移一个文件，验证编译通过后再继续
3. **保持运行时行为不变**：类型标注只增加编译时检查，不改变逻辑
4. **严格模式**：启用 `strict: true`，不遗漏 any 标注
5. **Vue SFC 末尾处理**：先完成所有 `.js` 迁移，再统一给 Vue 文件加 `lang="ts"`

---

## 二、工具链配置（第一步）

### 2.1 降级 TypeScript

当前 `package.json` 中的 TypeScript 版本为 `^7.0.2`，与 `vue-tsc 3.3.7` 不兼容。
**建议降级到 TypeScript 5.x**，这是 Vue 生态当前最佳支持的版本。

```bash
pnpm add -D typescript@~5.7.0
```

> 备选方案：保留 TS 7 但放弃 `vue-tsc`，改用 `tsc --noEmit` 只检查 `.ts` 文件。但这样无法对 `.vue` 文件做类型检查，不推荐。

### 2.2 创建 `tsconfig.json`

在项目根目录创建：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "jsxImportSource": "vue",
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vitest/globals"]
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.vue",
    "src/**/*.d.ts",
    "env.d.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "map-war-server"
  ]
}
```

### 2.3 创建 `env.d.ts`

```ts
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
```

### 2.4 删除 `jsconfig.json`

`tsconfig.json` 已包含 `paths` 配置，`jsconfig.json` 不再需要。

### 2.5 更新 `package.json` 脚本

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "build:skip-check": "vite build",
    "preview": "vite preview",
    "test:unit": "vitest",
    "lint": "run-s oxlint:* eslint",
    "oxlint:check": "oxlint",
    "typecheck": "vue-tsc --noEmit",
    "format": "prettier --write src/"
  }
}
```

### 2.6 更新 `vite.config.js` → `vite.config.ts`

```ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
```

---

## 三、分阶段迁移

### 阶段一：工具函数层（3 个文件，约 3 小时）

迁移顺序按依赖关系：从无依赖的叶子节点开始。

#### 3.1 `src/utils/locationResolver.js` → `locationResolver.ts`

**复杂度：中 | 风险：低 | 依赖：无外部 JS 依赖**

```
转换要点：
├── 为所有函数参数和返回值添加类型标注
├── 定义内部类型：Point { x: number; y: number }, ScreenBounds 等
├── 导出类型供其他模块使用
└── Feature 类型可暂时用 GeoJSON.Feature（后续可从 chinaCities 导入 CityData）
```

关键类型定义：

```ts
/** 屏幕坐标 */
export interface Point {
  x: number
  y: number
}

/** 经纬度坐标 */
export interface LatLng {
  lat: number
  lng: number
}

/** 地理边界 */
export interface GeoBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

/** 注册的地点信息 */
export interface RegisteredLocation {
  id: string
  centroid: Point
  feature?: GeoJSON.Feature
}
```

函数签名变更示例：

```ts
// Before
export function geoToScreen(lng, lat) { ... }

// After
export function geoToScreen(lng: number, lat: number): Point { ... }
```

#### 3.2 `src/utils/troopAnimation.js` → `troopAnimation.ts`

**复杂度：高 | 风险：中 | 依赖：locationResolver, pixi.js**

```
转换要点：
├── 定义动画参数接口（ArcAnimationOptions, ScoutAnimationOptions, BattleAnimationOptions）
├── 定义战斗返回值接口 BattleHandle
├── 为三种动画函数添加完整类型标注
├── pixi.js 类型：Container, Graphics, Text, TextStyle 直接从 pixi.js 导入
└── JSDoc 中有 @param {import('pixi.js').Container} 等标注，迁移后直接用 TS 类型
```

关键类型定义：

```ts
import type { Container, Graphics } from 'pixi.js'

export interface ArcAnimationOptions {
  from: { x: number; y: number }
  to: { x: number; y: number }
  container: Container
  mode?: 'dots' | 'orb'
  color?: number
  dots?: number
  spacing?: number
  duration?: number
  explosion?: boolean
  shockwaves?: number
  explosionDuration?: number
  text?: string
  textColor?: number
  highlightGfx?: Graphics
  fromFeature?: GeoJSON.Feature
  toFeature?: GeoJSON.Feature
  onHighlight?: (feature: GeoJSON.Feature, color: number) => void
}

export interface BattleHandle {
  stop: () => void
  graphics: Graphics
}

export function playArcAnimation(options: ArcAnimationOptions): Promise<void>
export function playScoutAnimation(options: ScoutAnimationOptions): Promise<void>
export function startBattleAnimation(options: BattleAnimationOptions): BattleHandle
```

#### 3.3 `src/utils/gameOrders.js` → `gameOrders.ts`

**复杂度：高 | 风险：中 | 依赖：troopAnimation, locationResolver**

```
转换要点：
├── 定义指令接口（AttackOrder, ScoutOrder, DeclareWarOrder, BattleOrder 等）
├── 定义指令执行结果接口
├── 内部状态（battles Map）需要明确类型标注
├── executeOrder 的参数和返回值需要完整的联合类型
└── AI 指令协议中的 JSON 对象需要对应类型定义
```

关键类型定义：

```ts
export interface GameOrder {
  order: 'attack' | 'scout' | 'declareWar' | 'battle' | 'stopBattle' | 'stopBattles' | 'listBattles'
  from?: string
  to?: string
  text?: string
}

export interface OrderResult {
  ok: boolean
  reason?: string
  data?: unknown
}

export interface BattleInfo {
  from: string
  to: string
  handle: import('./troopAnimation').BattleHandle
}

export function init(container: import('pixi.js').Container): void
export function executeOrder(order: GameOrder): Promise<OrderResult>
export function listBattles(): { from: string; to: string }[]
export function stopBattle(from: string, to: string): OrderResult
```

---

### 阶段二：基础设施层（2 个文件，约 1 小时）

#### 3.4 `src/stores/counter.js` → `counter.ts`

**复杂度：低 | 风险：极低 | 依赖：vue, pinia**

```ts
// Before
export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  const doubleCount = computed(() => count.value * 2)
  function increment() { count.value++ }
  return { count, doubleCount, increment }
})

// After — 逻辑不变，只是文件扩展名改为 .ts，自带类型推导
```

> 注意：此文件是模板占位，后续会被 `gameStore` 等替换。迁移只是为了消除最后一个 `.js` 文件。

#### 3.5 `src/router/index.js` → `index.ts`

**复杂度：低 | 风险：极低 | 依赖：vue-router**

```ts
import { createRouter, createWebHistory } from 'vue-router'
import MapView from '@/views/MapView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: MapView,
    },
  ],
})

export default router
```

---

### 阶段三：入口与测试（2 个文件，约 0.5 小时）

#### 3.6 `src/main.js` → `main.ts`

**复杂度：低 | 风险：低 | 依赖：vue, pinia, App.vue, router**

纯入口文件，无复杂逻辑。注意 `index.html` 中的 `<script>` 引用路径需要更新：

```html
<!-- index.html 中 -->
<script type="module" src="/src/main.ts"></script>
```

#### 3.7 `src/__tests__/App.spec.js` → `App.spec.ts`

**复杂度：低 | 风险：极低**

测试文件中修复过期的断言 `'You did it!'`。

---

### 阶段四：Vue SFC 迁移（7 个文件，约 4 小时）

所有 `.vue` 文件已经使用 `<script setup>`，迁移只需：
1. 在 `<script setup>` 上加 `lang="ts"`
2. 为 `defineProps` / `defineEmits` 添加类型参数
3. 为 `ref` / `computed` 等添加泛型参数（如果类型推导不精确）
4. 为事件处理函数添加参数类型

#### 3.8 UI 组件（5 个，风险低）

##### `GameButton.vue`

```vue
<script setup lang="ts">
defineProps<{
  active?: boolean
  danger?: boolean
}>()

defineEmits<{
  click: []
}>()
</script>
```

##### `GameContextMenu.vue`

```vue
<script setup lang="ts">
interface MenuItem {
  action: string
  label: string
  danger?: boolean
}

defineProps<{
  visible?: boolean
  position?: { x: number; y: number }
  items?: MenuItem[]
}>()

defineEmits<{
  select: [action: string]
}>()
</script>
```

##### `GameModal.vue`

```vue
<script setup lang="ts">
defineProps<{
  visible?: boolean
  title?: string
  minWidth?: string
  draggable?: boolean
  overlay?: boolean
  initX?: number
  initY?: number
}>()

defineEmits<{
  close: []
}>()
```

内部变量 `isDragging`, `offsetX`, `offsetY`, `panelX`, `panelY` 全为 `number`。

##### `InfoTable.vue`

```vue
<script setup lang="ts">
interface TableRow {
  label: string
  value: string | number
}

defineProps<{
  rows?: TableRow[]
}>()
</script>
```

##### `LegendPanel.vue`

```vue
<script setup lang="ts">
interface LegendItem {
  label: string
  color: string
}

defineProps<{
  items?: LegendItem[]
}>()
</script>
```

#### 3.9 `src/views/MapView.vue`

**复杂度：低 | 风险：极低**

只包裹 `<LeafletMap />`，无 props/emits，直接加 `lang="ts"` 即可。

#### 3.10 `src/components/LeafletMap.vue` ⚠️ 核心难点

**复杂度：极高 | 风险：高 | 行数：~930 行 | 预计耗时：2-3 小时**

```
迁移策略：
├── 先加 lang="ts"，不做大的类型重构，只修复编译错误
├── PixiJS 相关类型：Application, Container, Graphics, Text, TextStyle 都从 pixi.js 导入
├── GeoJSON Feature 类型：使用 GeoJSON.Feature
├── 大量 ref 变量：让 TS 自动推导，个别需要显式泛型
├── 事件处理函数：为参数添加类型
└── 后续架构重构（拆 composables）另立项，不在此次迁移范围
```

**关键变量类型标注：**

```ts
// PixiJS 实例
const app = ref<PixiJS.Application | null>(null)
const worldContainer = ref<PixiJS.Container | null>(null)

// 图层 Graphics
const chinaLayer = ref<PixiJS.Graphics | null>(null)
const worldLayer = ref<PixiJS.Graphics | null>(null)
const labelLayer = ref<PixiJS.Container | null>(null)

// GeoJSON 数据
const chinaGeoJSON = ref<GeoJSON.FeatureCollection | null>(null)
const worldGeoJSON = ref<GeoJSON.FeatureCollection | null>(null)

// 右键菜单
const contextMenu = ref<{
  visible: boolean
  position: { x: number; y: number }
  items: { action: string; label: string; danger?: boolean }[]
}>({ visible: false, position: { x: 0, y: 0 }, items: [] })
```

**可能踩坑的地方：**
1. `pixi.js` 中 `Graphics` 的 `drawPolygon` 等方法参数类型可能较严格
2. GeoJSON 坐标数组嵌套层级需要正确标注
3. 动态属性访问（`feature.properties[xxx]`）需要类型断言或守卫
4. 部分 `any` 可以接受，后续逐步收紧

#### 3.11 `src/App.vue`

**复杂度：极低 | 风险：极低**

添加 `lang="ts"`，全局 CSS reset 无需改动。

---

## 四、迁移依赖关系图

```
                    main.ts
                       │
                 ┌─────┴─────┐
              App.vue    router/index.ts
                 │            │
              MapView.vue     │
                 │            │
            LeafletMap.vue ←──┘
                 │
     ┌───────────┼───────────┐
     │           │           │
  UI组件×5   gameOrders.ts  (数据层 TS)
     (vue)       │           │
              troopAnimation.ts  chinaCities.ts
                 │           worldCountries.ts
              locationResolver.ts  ownerColors.ts
                                   owners.ts
```

**推荐迁移顺序：**
```
1. locationResolver.ts  ← 无依赖
2. troopAnimation.ts    ← 依赖 1
3. gameOrders.ts        ← 依赖 1, 2
4. counter.ts           ← 无依赖
5. router/index.ts      ← 依赖 MapView.vue（但仅引用，不阻塞）
6. main.ts              ← 依赖 5, App.vue
7. App.spec.ts          ← 依赖 main.ts
8. GameButton.vue       ← 最简单
9. GameContextMenu.vue
10. InfoTable.vue
11. LegendPanel.vue
12. GameModal.vue       ← 最复杂的 UI 组件
13. MapView.vue
14. LeafletMap.vue      ← 最复杂，最后做
```

---

## 五、风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| **TS 7 与 vue-tsc 不兼容** | 🔴 高 | 降级到 TS 5.7，待生态跟上后再升级 |
| **LeafletMap.vue 改动大** | 🟡 中 | 先加 `lang="ts"` 最小改动过编译，类型不精确处用 `as any` 标记 TODO，后续架构重构时处理 |
| **PixiJS 类型复杂** | 🟡 中 | PixiJS 8 自带完整类型声明，直接使用；动态属性访问加类型断言 |
| **GeoJSON 坐标类型** | 🟢 低 | 使用 `GeoJSON.Feature` / `GeoJSON.FeatureCollection` 标准类型 |
| **构建失败** | 🟡 中 | 保留 `build:skip-check` 脚本作为逃生舱；每次改完一个文件就跑 `vue-tsc --noEmit` |
| **`index.html` 引用路径** | 🟢 低 | 改 `main.js` → `main.ts` 即可 |

---

## 六、检查清单

### 配置层
- [ ] `typescript` 版本降级到 `~5.7.0`
- [ ] 创建 `tsconfig.json`
- [ ] 创建 `env.d.ts`
- [ ] 删除 `jsconfig.json`
- [ ] 更新 `package.json` scripts
- [ ] `vite.config.js` → `vite.config.ts`
- [ ] `vitest.config.js` → `vitest.config.ts`（可选）

### 工具函数层
- [ ] `locationResolver.js` → `.ts` + 类型接口
- [ ] `troopAnimation.js` → `.ts` + 参数接口
- [ ] `gameOrders.js` → `.ts` + 指令接口

### 基础设施层
- [ ] `stores/counter.js` → `.ts`
- [ ] `router/index.js` → `.ts`

### 入口与测试
- [ ] `main.js` → `.ts`
- [ ] `index.html` 引用更新
- [ ] `__tests__/App.spec.js` → `.ts`

### Vue SFC
- [ ] `GameButton.vue` + `lang="ts"` + 类型化 props/emits
- [ ] `GameContextMenu.vue` + `lang="ts"` + 类型化 props/emits
- [ ] `InfoTable.vue` + `lang="ts"` + 类型化 props/emits
- [ ] `LegendPanel.vue` + `lang="ts"` + 类型化 props/emits
- [ ] `GameModal.vue` + `lang="ts"` + 类型化 props/emits
- [ ] `MapView.vue` + `lang="ts"`
- [ ] `LeafletMap.vue` + `lang="ts"`（最大工程）
- [ ] `App.vue` + `lang="ts"`

### 验证
- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm build` 构建成功
- [ ] `pnpm dev` 开发服务器正常启动
- [ ] `pnpm test:unit` 测试通过

---

## 七、后续优化（不在此次范围）

1. **LeafletMap.vue 拆分**：提取 composables（`usePixiApp`, `useMapInteraction`, `useLayerRenderer` 等）
2. **Pinia Store 实现**：用 `gameStore` 替代 `counter.ts`，实现事件溯源 + Kernel 模式
3. **严格 noImplicitAny**：逐步消除所有 `any`，尤其是 LeafletMap.vue 中的 TODO
4. **引入 Terrain 枚举**：在 `owners.ts` 同目录下添加 `terrain.ts`
5. **GeoJSON Feature 泛化**：为城市 Feature 和国家 Feature 创建带泛型 property 的类型
