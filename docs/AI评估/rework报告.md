# 烽火舆图 · 项目重构评估报告（v2 复核版）

> 生成日期：2026-07-31
> 上次报告：2026-07-28（v1）
> 范围：全仓通读 `apps/web/src` + `apps/server/src` + 关键设计文档
> 方法：静态分析 + 行数复核 + 模块级状态扫描 + 后端依赖核对

---

## 0. 本次复核摘要

距 v1 报告仅 3 天，代码主线**未做大规模拆分**，但在类型契约、LLM 客户端、外交/经济系统上有可见的小步前进。本版主要价值是**核对 v1 建议的落地情况**，并补齐 v1 遗漏的后端与单文件热点。

### 0.1 v1 建议落地情况速查

| v1 建议 | 当前状态 | 证据 |
|---|---|---|
| `CityState.fieldForce` 显式声明 | ✅ 已修复 | [game.ts:74](file:///d:/work/map-war/apps/web/src/stores/game.ts#L74) `fieldForce: number` |
| `SaveData` 加 `version` | ✅ 已有 | [game.ts:162](file:///d:/work/map-war/apps/web/src/stores/game.ts#L162) `version: number` + `telegrams?/turnCount?/diplomacyRecords?` |
| `ORDER_TYPES` 单一真相源 | ✅ 已修复 | [gameOrders.ts:66-91](file:///d:/work/map-war/apps/web/src/utils/gameOrders.ts#L66) `as const` + `OrderType = (typeof ORDER_TYPES)[number]` |
| `Telegram` 加 `id` | ✅ 已修复 | [game.ts:40](file:///d:/work/map-war/apps/web/src/stores/game.ts#L40) `id: string` |
| `BattleInfo.lastNarrative` 可空标注 | ✅ 已修复 | [game.ts:35](file:///d:/work/map-war/apps/web/src/stores/game.ts#L35) `lastNarrative?: string` |
| LLM 客户端结构化重试 | ✅ 已修复 | [useLlmClient.ts:31-89](file:///d:/work/map-war/apps/web/src/composables/useLlmClient.ts#L31) `NonRetryableError` + 4xx 不重试 / 5xx 退避 |
| 经济系统落地 | ✅ 已落地 | [useAgentKernel.ts:140](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L140) `runEconomicTick` + `economicTick` event |
| 外交总线 | ✅ 已落地 | `useDiplomacyBus` + `DiplomaticProposal` |
| 拆 `LeafletMap.vue` | ⬜ 未拆 | 仍 2643 行（v1: 2842） |
| 拆 `gameOrders.ts` | ⬜ 未拆 | 仍 1068 行（v1: 1108） |
| 拆 `game.ts` | ⬜ 未拆 | 反增至 1009 行（v1: 924） |
| `ownership` 改 `shallowRef` | ⬜ 未改 | [game.ts:225](file:///d:/work/map-war/apps/web/src/stores/game.ts#L225) 仍 `computed` 全量重建 |
| 内存上限 / LRU | ⬜ 未加 | `telegrams/eventLog/undoStack/chatTurns/geoJsonCache` 均无上限 |
| LLM 调用超时 | ⬜ 未加 | [useLlmClient.ts:85](file:///d:/work/map-war/apps/web/src/composables/useLlmClient.ts#L85) 仅 `setTimeout` 退避，无 `AbortSignal.timeout` |
| 后端限流 | ⬜ 未加 | [app.module.ts](file:///d:/work/map-war/apps/server/src/app.module.ts) 无 `ThrottlerModule` |
| `GameEvent` 加 `id` | ⬜ 未加 | [game.ts:132-152](file:///d:/work/map-war/apps/web/src/stores/game.ts#L132) 无 `id` 字段 |
| `Telegram` 加 `sentAt` | ⬜ 未加 | 仅有 `turn` + `gameDate` |
| `SaveData` 迁移逻辑 | ⬜ 未加 | 有 `version` 但无 `migrate()` |
| `save/load` 返回 `Result<T>` | ⬜ 未改 | [game.ts:879/909](file:///d:/work/map-war/apps/web/src/stores/game.ts#L879) 仍返回 `boolean` |

**结论**：v1 列出的「类型契约 / LLM 客户端」类小修已落地；「文件拆分 / 性能 / 内存 / 超时 / 限流」类结构性改动**零落地**。

---

## 1. 总体结论

项目仍处于 v1 描述的**「设计领先、落地 partially、工程债累积」**阶段，且部分热点**反向恶化**：

- ✅ 架构设计文档详尽，核心决策（Kernel 唯一写者、事件溯源、P0-P4 回合流、电报/顾问/事件日志、经济系统、外交总线、地形修正）**已落地**；
- 🟡 前端单文件过载**未拆且部分变大**：`game.ts` +85 行、`troopAnimation.ts` 成为新热点（678 行）、`executeOrder` ~328 行（v1: ~260）、`applyEvent` ~234 行（v1: ~150）；
- ⬜ 后端**严重空壳化**：装了 `typeorm` + `better-sqlite3` 但**零使用**（README 误导），无 Swagger、无限流、无超时、无 schema 校验、无测试；
- ⬜ 测试覆盖率仍偏低，核心 reducer / 调度器 / 存档 / 后端**全无测试**。

**建议优先级（不变）**：先拆文件（可读性）→ 补核心测试（安全网）→ 修性能与内存（体验）→ 上后端工程化（可观测 + 安全）。

---

## 2. 架构健康度

### 2.1 已对齐的设计（Strengths）

| 设计决策 | 落地状态 | 证据 |
|---|---|---|
| 权威态在前端，后端仅 LLM 透传 | ✅ | [ai.service.ts:36](file:///d:/work/map-war/apps/server/src/ai/ai.service.ts#L36) 纯 `chat.completions.create` |
| Kernel = 唯一写者（`applyEvent`） | ✅ | [game.ts:616](file:///d:/work/map-war/apps/web/src/stores/game.ts#L616) `applyEvent` reducer |
| 事件溯源 + replay | ✅ | `eventLog` 持久化到 localStorage，`load()` 逐事件重放 |
| 兵力/士气下沉到城市级 | ✅ | `CityState.troops/morale/fieldForce`，`factionTroops/factionMorale` 派生 |
| P0-P4 回合流水线 | ✅ | [useAgentKernel.ts:207](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L207) `runWorldTurn` 四阶段全通 |
| 经济结算（P0） | ✅ | [useAgentKernel.ts:140](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L140) `runEconomicTick` 落 `economicTick` event |
| 外交总线 | ✅ | `useDiplomacyBus` + `DiplomaticProposal` 已串入 P3 |
| 电报 / 顾问 / 事件日志面板 | ✅ | `TelegramPanel` / `AdvisorPanel` / `EventLogPanel` 均已落地 |
| 城市邻接图注入 AI 上下文 | ✅ | `chinaCitiesAdjacent.ts` + `aiContext.ts` |
| 动画与状态分离 | ✅ | `troopAnimation.ts` 纯视觉，`gameOrders.ts` 编排，`applyEvent` 落库 |
| LLM 客户端重试分类 | ✅ | [useLlmClient.ts:31-89](file:///d:/work/map-war/apps/web/src/composables/useLlmClient.ts#L31) 4xx 不重试、5xx 退避 |
| `gameConfig.ts` 集中调参 | ✅ | 7 大类常量统一管理 |

### 2.2 架构债务（Architectural Debt）

| 问题 | 风险 | 当前状态 | 建议 |
|---|---|---|---|
| `LeafletMap.vue` 2643 行，混地图渲染/UI 状态/相机/战斗卡片/右键菜单/模态框 | 维护困难 | ⬜ 未拆 | 拆 `MapRenderer` / `MapCamera` / `BattleCardLayer` / `MapUiOverlay` |
| `gameOrders.ts` 1068 行，giant switch + 模块级可变状态 | 新增指令成本高 | ⬜ 未拆 | 拆 `orders/` 目录 + `OrderRegistry` 类 |
| `game.ts` 1009 行（**反增 85**），reducer+存档+电报+派生全塞 | 类型改动影响面大 | ⬜ 反而恶化 | 拆 `game.reducer.ts` / `game.save.ts` / `game.telegram.ts` / `game.selectors.ts` |
| `troopAnimation.ts` **678 行（v1 未提，新热点）** | 动画函数堆叠 | ⚠️ 新增 | 拆 `animation/arc.ts` / `scout.ts` / `battle.ts` / `capture.ts` / `develop.ts` |
| `useAiOrchestrator.ts` 494 行，prompt 组装+解析+校验+执行全耦合 | 调试 AI 链路难追踪 | ⚠️ 新增 | 拆 `orchestrator/prompt.ts` / `parse.ts` / `execute.ts` |
| 模块级单例（`useGameScheduler` / `useAgentKernel` / `useAiOrchestrator`）用 Vue `ref` 持有，无 `dispose()` | HMR 状态残留，测试隔离难 | ⬜ 未改 | 改类单例 + `dispose()` |
| `gameOrders.ts` 模块级 `_container/_camera/_app` 可变全局 | 多实例 impossible，测试需 mock | ⬜ 未改 | 改 `GameOrdersEngine` 类 + inject |
| 后端装了 `typeorm`+`better-sqlite3` 但**零使用** | 依赖体积虚增，README 误导 | ⬜ 未清 | 二选一：要么真用（存档/电报持久化），要么从 `package.json` 移除 |

---

## 3. 代码质量与可维护性

### 3.1 类型安全

| 问题 | 现状 | 建议 |
|---|---|---|
| `as Record<string, unknown>` 大量散布 | `aiParse.ts` / `aiDiplomacy.ts` / `gameOrders.ts` / `useAgentKernel.ts` 均有，AI 回包解析处尤其密集 | AI 回包统一走 `zod` schema 解析，失败即 reject |
| `as Owner` 断言 | `labelToOwner` 映射后强转 ([useAgentKernel.ts:79](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L79)) | 改为 `labelToOwner.get(label) ?? Owner.NEUTRAL` 显式回退 |
| `as unknown as Record<string, CityState>` | [useGameScheduler.ts:67/121](file:///d:/work/map-war/apps/web/src/composables/useGameScheduler.ts#L67) `store.cities as unknown as Record<string, CityState>` | `cities` 已是 `shallowRef<Record<string, CityState>>`，断言多余，直接 `store.cities` 即可 |
| `GameEvent` 联合类型未加 `id` | replay/调试时难追踪单条事件 | 加 `id?: string` 可选字段，`applyEvent` 时生成 |
| `Telegram` 缺 `sentAt` 时间戳 | 仅靠 `turn` 近似排序 | 补 `sentAt: number`（`Date.now()`） |
| `SaveData` 有 `version` 但无 `migrate` | 未来 schema 变更时老存档全废 | 加 `migrate(old, fromVer)` 函数 |
| `OWNER_COLORS as Record<string, number>` | [LeafletMap.vue:767](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L767) 强转 | 在 `owners.ts` 直接声明为 `Record<string, number>` |
| `app.destroy(true)` 未清理 texture | [LeafletMap.vue:2137](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L2137) | 改 `app.destroy(true, { children: true, texture: true })` |

### 3.2 函数复杂度（行数复核，多较 v1 反增）

| 函数 | 位置 | v1 行数 | 当前行数 | 趋势 |
|---|---|---|---|---|
| `applyEvent` | [game.ts:616-877](file:///d:/work/map-war/apps/web/src/stores/game.ts#L616) | ~150 | ~234 | ⬆️ 恶化 |
| `preCheck` | [game.ts:538-615](file:///d:/work/map-war/apps/web/src/stores/game.ts#L538) | ~60 | ~77 | ⬆️ |
| `executeOrder` | [gameOrders.ts:740-1068](file:///d:/work/map-war/apps/web/src/utils/gameOrders.ts#L740) | ~260 | ~328 | ⬆️ 恶化 |
| `getSnapshot` | [game.ts:493-537](file:///d:/work/map-war/apps/web/src/stores/game.ts#L493) | — | ~44 | OK |
| `runWorldTurn` | [useAgentKernel.ts:207-375](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L207) | — | ~168 | OK |
| `settleActiveBattles` | [useGameScheduler.ts:51-226](file:///d:/work/map-war/apps/web/src/composables/useGameScheduler.ts#L51) | — | ~175 | 偏大 |
| `playTimeJump` | [gameOrders.ts:401](file:///d:/work/map-war/apps/web/src/utils/gameOrders.ts#L401) | — | ~130 | 偏大 |

### 3.3 命名与一致性

| 问题 | 现状 | 建议 |
|---|---|---|
| `factionTroops(o)` 函数 vs `myStats` computed | API 不一致 | 统一为 selector |
| `ORDER_TYPES` 已 `as const` | ✅ 已修复 v1 问题 | 保持 |
| `playTimeJump` 同时做云雾+日期推进+toast | 职责过载 | 拆 `playCloudTransition` + `applyDateAdvance` + `notifyDateJump` |
| `needsPlayerDecision` 挂在 `GameOrder` 而非 `GameEvent` | replay 时不保留 | 迁到 `GameEvent` 或单独 `PlayerDecisionEvent` |

---

## 4. 性能热点

### 4.1 已识别的热点（复核）

| 热点 | 位置 | 复杂度 | 影响 |
|---|---|---|---|
| `ownership` computed | [game.ts:225-227](file:///d:/work/map-war/apps/web/src/stores/game.ts#L225) | O(N) 每次 `cities` 变化 | `Object.fromEntries(Object.entries(...))` 全量重建 |
| `factionTroops(o)` / `factionMorale(o)` | [game.ts:276/281](file:///d:/work/map-war/apps/web/src/stores/game.ts#L276) | O(N) 每调用 | P3 每势力每回合多次调用 |
| `myStats` computed | [game.ts:330](file:///d:/work/map-war/apps/web/src/stores/game.ts#L330) | O(N) + sort | `currentFaction` 变化重算 |
| `getSnapshot` | [game.ts:493](file:///d:/work/map-war/apps/web/src/stores/game.ts#L493) | O(N) 深拷贝 | P2/P3 至少各调一次 |
| `loadLayer` | `LeafletMap.vue` | O(M features) | ownership watcher 易主全量重绘 |
| `syncBattleCards` | `LeafletMap.vue` | O(B²) 碰撞 | 每帧调用 |
| `pointInPolygon` | `LeafletMap.vue` | O(ring length) | 点击测试遍历所有 feature |

### 4.2 优化建议（不变）

1. `ownership` 改 `shallowRef`，`applyEvent` 末尾局部更新 + `triggerRef`；
2. `loadLayer` 加 100ms debounce；
3. 点击测试用 RBush 空间索引，`pointInPolygon` 仅在候选 bbox 内做；
4. `syncBattleCards` 拖拽期间降频（每 3 帧）；
5. `getSnapshot` 单次取 snap 传入所有 faction context；
6. `formatCityCompact` 缓存到 `Map<gb, string>`。

---

## 5. 内存与资源管理

| 风险点 | 现状 | 建议 |
|---|---|---|
| PixiJS `Application` 销毁 | [LeafletMap.vue:2137](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L2137) `app.destroy(true)` | 改 `app.destroy(true, { children: true, texture: true })` |
| `battleRegistry` / `activeBattles` 模块级 Map | [gameOrders.ts:154-155](file:///d:/work/map-war/apps/web/src/utils/gameOrders.ts#L154) `resetBattleRuntime` 清空，但 `LeafletMap.onUnmounted` **未调用** | 在 [onUnmounted](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L2126) 末尾加 `resetBattleRuntime()` |
| `geoJsonCache` 无限增长 | [LeafletMap.vue:707](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L707) 只进不出 | 加 LRU 上限 5 / `onUnmounted` 清空 |
| `telegrams` 无上限 | [game.ts:970](file:///d:/work/map-war/apps/web/src/stores/game.ts#L970) `push` 无检查 | `MAX_TELEGRAMS = 500`，超限 shift 最早 |
| `eventLog` 无上限 | 每回合 P3/P4 追加 | `MAX_EVENTLOG = 2000`，超限压缩早期；或后端存储 |
| `chatTurns` 无上限 | [useAiOrchestrator.ts:87](file:///d:/work/map-war/apps/web/src/composables/useAiOrchestrator.ts#L87) | `MAX_CHAT_TURNS = 20` |
| `undoStack` 无上限 | `useAiOrchestrator` | `MAX_UNDO = 50` |
| `troopAnimation` 短动画 RAF 无取消入口 | [troopAnimation.ts:312/366/481/683](file:///d:/work/map-war/apps/web/src/utils/troopAnimation.ts#L312) `playArcAnimation` / `playScoutAnimation` / `playExplosion` / `playDevelopAnimation` 用 RAF 递归，仅 `startBattleAnimation`（L593）有 cancel 入口 | 短动画也注册到 `resetBattleRuntime` 的取消表，或返回 `cancel()` 句柄 |
| `cloudTransition` 资源销毁 | [LeafletMap.vue:2136](file:///d:/work/map-war/apps/web/src/components/LeafletMap.vue#L2136) `disposeCloudTransition()` 已调用 | ✅ 已修复 |

---

## 6. 错误处理与可观测性

| 问题 | 现状 | 建议 |
|---|---|---|
| `executeOrder` catch 后 toast「指令出错」无原始错误 | [useGameScheduler.ts:261](file:///d:/work/map-war/apps/web/src/composables/useGameScheduler.ts#L261) 仅 `console.warn` + 通用 toast | dev 模式附带 `error.message` |
| LLM 失败仅 toast | [useAgentKernel.ts:88](file:///d:/work/map-war/apps/web/src/composables/useAgentKernel.ts#L88) 解析失败弹 toast | 加 `lastError` 字段，`AiDebugPanel` 可查原始 err |
| `load` 读档失败静默返回 `false` | [game.ts:909](file:///d:/work/map-war/apps/web/src/stores/game.ts#L909) 返回 boolean | 改 `{ ok: false; reason: string }` |
| `save` 失败静默返回 `false` | [game.ts:879](file:///d:/work/map-war/apps/web/src/stores/game.ts#L879) | 同上 |
| 无前端日志分级 | `console.log/warn/error` 混用 | 引入 `logger` 工具按 `DEBUG/INFO/WARN/ERROR` 分级 |
| 无前端监控 | 异常 / LLM 延迟 / 帧率均无采集 | 接 Sentry / 自建 `monitor`，采集 `llmDuration` / `orderExecuteDuration` / `battleCount` |
| LLM 调用无超时 | [useLlmClient.ts:85](file:///d:/work/map-war/apps/web/src/composables/useLlmClient.ts#L85) 仅 `setTimeout` 退避，**无 `AbortSignal.timeout`** | 加 `AbortSignal.timeout(30000)`，超时 fallback 叙事 |
| 后端 LLM 调用无超时 | [ai.service.ts:36](file:///d:/work/map-war/apps/server/src/ai/ai.service.ts#L36) 直接 `await`，无超时 | OpenAI client 传 `timeout: 30000` |

---

## 7. 安全性与输入验证

| 问题 | 现状 | 建议 |
|---|---|---|
| 后端无限流 | [app.module.ts](file:///d:/work/map-war/apps/server/src/app.module.ts) 无 `ThrottlerModule` | 加 `@nestjs/throttler`（每 IP 100 次/分） |
| 后端无请求体大小限制 | `main.ts` 未 `use(express.json({ limit }))` | 加 `app.use(bodyParser.json({ limit: '1mb' }))` |
| 后端 Controller 无 schema 校验 | [ai.controller.ts:10](file:///d:/work/map-war/apps/server/src/ai/ai.controller.ts#L10) `@Body() body: Record<string, unknown>`，`ValidationPipe` 形同虚设 | 用 DTO class + `class-validator` 装饰器，或 `zod` |
| 前端 `playerName` XSS | 需审计 `v-html` 使用 | 确保所有用户输入走 Vue 模板插值，禁 `v-html` |
| `chinaCities.seed.json` 无 schema 校验 | 若来自用户上传 | 加 `zod` 校验 |
| localStorage 存档无签名 | 玩家可改 JSON | 加 HMAC 检测篡改 |
| DeepSeek API Key 仅存后端 `.env` | ✅ | 保持 |
| CORS 配置 | [main.ts:7-8](file:///d:/work/map-war/apps/server/src/main.ts#L7) `CORS_ORIGIN` 可配，默认 5173 | ✅ |
| **后端无 Swagger/OpenAPI 文档** | [app.module.ts](file:///d:/work/map-war/apps/server/src/app.module.ts) 无 `DocumentBuilder` | 加 `@nestjs/swagger` 生成 `/api/docs`（**项目约定要求后端接口同步到 Swagger**） |

---

## 8. 测试覆盖缺口

### 8.1 已有测试（14 个，与 v1 一致，无新增）

| 文件 | 覆盖范围 |
|---|---|
| `aiContext.spec.ts` | 上下文构建 |
| `aiOrderContract.spec.ts` | 指令校验 |
| `llmClient.spec.ts` | LLM 客户端 |
| `gameStore.spec.ts` | store 基本操作 |
| `aiHistory.spec.ts` | 历史装配 |
| `aiParse.spec.ts` | 指令解析 |
| `aiPromptBuilder.spec.ts` | Prompt 构建 |
| `aiClassify.spec.ts` | 势力分类 |
| `aiDiplomacyBus.spec.ts` | 外交总线 |
| `battleFormula.spec.ts` | 战斗公式 |
| `commsEntity.spec.ts` | 电报实体 |
| `gameOrders.spec.ts` | 指令执行（部分） |
| `locationResolver.spec.ts` | 地名解析 |
| `orderText.spec.ts` | 指令文本 |

### 8.2 缺失的关键测试（与 v1 一致，均未补）

| 模块 | 优先级 | 建议用例 |
|---|---|---|
| `game.ts` `applyEvent` | P0 | 每条 `GameEvent` happy path + preCheck 拦截 + replay 等价性 |
| `game.ts` `save/load` | P0 | 多槽位、老存档兼容、损坏存档容错 |
| `game.ts` `economicTick` | P0 | 各势力收支 + 欠饷/缺粮惩罚 + replay 一致性 |
| `gameOrders.ts` `executeOrder` | P0 | 每指令动画 mock + world state 验证 |
| `useGameScheduler.ts` | P0 | submit + advance + needsPlayerDecision 停点 + 异常跳过 |
| `useAgentKernel.ts` | P1 | `endPlayerTurn` 四阶段 mock LLM + 失败 fallback |
| `LeafletMap.vue` | P2 | 点击测试、相机补间、图层切换 |
| 后端 `AiService` | P1 | LLM 成功/失败/未配置三种路径 |

### 8.3 测试基础设施（与 v1 一致）

- 缺 E2E（Playwright，覆盖「开局→选势力→玩家指令→结束回合→世界推演→读档」）；
- 缺视觉回归（PixiJS 渲染截图对比）；
- 缺 AI 契约一致性测试（固定 fixture → LLM → 校验 JSON 符合 schema）。

---

## 9. 后端专项评估（v1 遗漏，本次新增）

### 9.1 文件清单与行数

| 文件 | 行数 | 职责 |
|---|---|---|
| [main.ts](file:///d:/work/map-war/apps/server/src/main.ts) | 14 | bootstrap：CORS + ValidationPipe + 全局前缀 `api` + 监听 3001 |
| [app.module.ts](file:///d:/work/map-war/apps/server/src/app.module.ts) | 12 | 仅 `ConfigModule` + `AiModule` + `AppController` |
| [app.controller.ts](file:///d:/work/map-war/apps/server/src/app.controller.ts) | — | 健康检查 |
| [ai.module.ts](file:///d:/work/map-war/apps/server/src/ai/ai.module.ts) | 10 | `AiController` + `AiService` |
| [ai.controller.ts](file:///d:/work/map-war/apps/server/src/ai/ai.controller.ts) | 11 | 单路由 `POST /api/ai/chat` |
| [ai.service.ts](file:///d:/work/map-war/apps/server/src/ai/ai.service.ts) | 43 | 调 `chat.completions.create`，失败抛 502 |
| [llm.client.ts](file:///d:/work/map-war/apps/server/src/ai/llm.client.ts) | 39 | OpenAI client 工厂 + env 校验 |

### 9.2 后端债务清单

| 问题 | 严重度 | 说明 |
|---|---|---|
| **无 Swagger 文档** | 高 | 项目约定要求后端接口同步 Swagger，但零配置 |
| **无 schema 校验** | 高 | `@Body() body: Record<string, unknown>` 完全不校验，`ValidationPipe` 配了 `whitelist:true` 但对 `Record` 无效 |
| **无限流** | 高 | 任一前端可无限调用，账单风险 |
| **无 body 大小限制** | 中 | LLM 上下文可能极大，OOM/慢请求风险 |
| **无超时** | 中 | `ai.service.ts:36` 直接 await，DeepSeek 慢时请求挂死 |
| **装了 typeorm + better-sqlite3 但零使用** | 中 | [package.json:23-24](file:///d:/work/map-war/apps/server/package.json#L23) 装了，但 `app.module.ts` 无 `TypeOrmModule`，无 entity，无任何 DB 调用。**README 第 8 行「NestJS + TypeORM + better-sqlite3」描述与实际不符** |
| **无测试** | 中 | `package.json` 有 `test` 脚本但无 `test/` 目录 |
| **无日志分级** | 低 | 仅 `Logger.error/warn`，无结构化日志 |
| **无监控** | 低 | LLM 延迟/失败率/调用量均无采集 |
| **错误信息泄露** | 低 | [ai.service.ts:43](file:///d:/work/map-war/apps/server/src/ai/ai.service.ts#L43) 把原始 `err.message` 透传给前端，生产环境应脱敏 |

### 9.3 后端改进路线

1. **加 Swagger**：`@nestjs/swagger` + `DocumentBuilder`，暴露 `/api/docs`，为 `chat` 路由写 DTO class；
2. **加限流**：`@nestjs/throttler`，`ThrottlerModule.forRoot({ ttl: 60, limit: 100 })`；
3. **加 body 限制**：`main.ts` 加 `app.use(bodyParser.json({ limit: '1mb' }))`；
4. **加超时**：OpenAI client 传 `timeout: 30000`，或 `Promise.race` 包一层；
5. **加 schema 校验**：定义 `ChatDto` class + `class-validator` 装饰器（`messages: array`、`model?: string`、`reasoning_effort?: 'low'|'medium'|'high'`）；
6. **清理虚假依赖**：从 `package.json` 移除未用的 `typeorm` + `better-sqlite3` + `@nestjs/typeorm`，或真正落地存档/电报持久化；
7. **修正 README**：把「TypeORM + better-sqlite3」改为「纯 LLM 透传代理」；
8. **加健康检查**：`/api/health` 返回 `{ status, llmConfigured: bool }`；
9. **加单测**：`AiService` mock OpenAI client，覆盖成功/失败/未配置三路径。

---

## 10. 依赖与构建

| 问题 | 现状 | 建议 |
|---|---|---|
| TS 5.7.3 锁定 | 不升级 7.x | 关注 `vue-tsc` 兼容性 |
| `pixi.js` 8.19.0 | API 稳定 | 锁版本 |
| `unplugin-icons` + `@iconify-json/tabler` | 已接入 | 保持 |
| `pnpm` workspace | 单仓多包 | 保持 |
| 后端虚假依赖 | `typeorm` + `better-sqlite3` 装而不用 | 移除或真用 |
| 无 CI/CD | ❓ | 加 GitHub Actions：`typecheck` + `lint` + `build` + `test` |

---

## 11. 重构路线图（v2 修订）

### Phase 1：文件拆分（风险低，收益高）

1. **拆 `LeafletMap.vue`**（2643 → 目标 800 内）
   - `MapCamera.ts`（相机状态 + `animateCameraTo` + `applyCamera` + `rubberbandClamp`）
   - `BattleCardLayer.vue`（战斗卡片 DOM 层 + `syncBattleCards`）
   - `MapContextMenu.vue`（右键菜单）
   - `MapModals.ts`（信息模态、调试模态、战斗列表模态）

2. **拆 `gameOrders.ts`**（1068 → 目标 300 内）
   - `orders/arrow.ts` / `battle.ts` / `capture.ts` / `city.ts` / `meta.ts`
   - `OrderRegistry` 类封装 `battleRegistry` / `activeBattles` / `locks`

3. **拆 `game.ts`**（1009 → 目标 300 内）
   - `game.reducer.ts`：`applyEvent` + `preCheck` + `GameEvent` 类型
   - `game.save.ts`：`save/load/deleteSave/listSaves` + `migrate`
   - `game.telegram.ts`：`Telegram` + `pushTelegram` + `unreadCount` + `MAX_TELEGRAMS`
   - `game.selectors.ts`：`myStats` / `factionTroops` / `factionMorale`

4. **拆 `troopAnimation.ts`**（678 → 目标 200 内，**v2 新增**）
   - `animation/arc.ts` / `scout.ts` / `battle.ts` / `capture.ts` / `develop.ts`
   - 统一 `cancel()` 句柄注册到 `resetBattleRuntime`

5. **拆 `useAiOrchestrator.ts`**（494 → 目标 200 内，**v2 新增**）
   - `orchestrator/prompt.ts` / `parse.ts` / `execute.ts`

### Phase 2：类型安全与测试

6. **消灭 `as` 断言**
   - `OWNER_COLORS` 在 `owners.ts` 直接声明 `Record<string, number>`
   - `store.cities as unknown as Record<string, CityState>` 直接去掉（[useGameScheduler.ts:67/121](file:///d:/work/map-war/apps/web/src/composables/useGameScheduler.ts#L67)）
   - `GameEvent` 加 `id?: string`，`Telegram` 加 `sentAt: number`
   - AI 回包统一走 `zod` schema

7. **补核心测试**（applyEvent / executeOrder / save/load / useGameScheduler / useAgentKernel）

8. **加测试基础设施**（`@testing-library/vue` + Playwright E2E）

### Phase 3：性能与内存

9. **优化高频路径**：`ownership` 改 `shallowRef` + 局部更新；`loadLayer` debounce；`syncBattleCards` 降频；RBush 空间索引

10. **内存治理**：`telegrams`/`eventLog`/`undoStack`/`chatTurns`/`geoJsonCache` 全加上限/LRU；`app.destroy(true, { texture: true })`；`onUnmounted` 加 `resetBattleRuntime()`

### Phase 4：后端工程化（**v2 新增独立 Phase**）

11. **Swagger**：`@nestjs/swagger` + DTO + `/api/docs`（满足项目约定）
12. **限流**：`@nestjs/throttler`
13. **schema 校验**：`ChatDto` + `class-validator`
14. **超时**：OpenAI client `timeout: 30000`
15. **清理虚假依赖**：移除未用的 `typeorm` / `better-sqlite3`
16. **修正 README**：后端描述改为「纯 LLM 透传代理」
17. **加单测**：`AiService` 三路径 mock

### Phase 5：可观测性与 CI

18. **前端 logger + 监控**
19. **后端结构化日志 + 监控**
20. **CI/CD**：GitHub Actions typecheck → lint → build → test

---

## 12. 风险与注意事项

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 拆文件时遗漏模块级状态引用 | 中 | 运行时 crash | 拆前 `grep` 列出所有引用点，拆后逐一核对 |
| 修改 `applyEvent` 导致 replay 不一致 | 低 | 存档损坏 | 改前必写单测，replay 用例固定 seed |
| `ownership` 改 `shallowRef` 后 watcher 不触发 | 中 | 地图不更新 | `applyEvent` 末尾手动 `triggerRef` |
| LLM 调用超时导致 P3/P4 卡死 | 中 | 玩家体验差 | 加 30s timeout + fallback 叙事 |
| 后端加限流误伤合法调用 | 低 | 玩家被限 | 限流阈值设宽（100/min），仅防滥用 |
| 移除 `typeorm`/`better-sqlite3` 误伤未来计划 | 低 | 重复安装 | 先确认无任何 DB 使用计划再移除 |

---

## 13. 优先级总结（v2 修订）

| 优先级 | 事项 | 预期收益 |
|---|---|---|
| **P0** | 拆 `LeafletMap.vue` + `gameOrders.ts` + `game.ts` + `troopAnimation.ts` | 可维护性飙升 |
| **P0** | 补 `applyEvent` + `executeOrder` + `save/load` + `useGameScheduler` 测试 | 重构安全网 |
| **P0** | 后端加 Swagger（满足项目约定） | 接口文档化 |
| **P1** | 消灭关键 `as` 断言 + 补 `GameEvent.id` / `Telegram.sentAt` / `SaveData.migrate` | 类型安全 |
| **P1** | `ownership` 改 `shallowRef` + `loadLayer` debounce | 渲染帧率稳定 |
| **P1** | 内存上限 + LRU + `app.destroy` texture 清理 | 长局不 OOM |
| **P1** | LLM 超时（前端 `AbortSignal.timeout` + 后端 client timeout） | P3/P4 不卡死 |
| **P1** | 后端限流 + body 限制 + schema 校验 | 账单/安全 |
| **P2** | 清理后端虚假依赖（typeorm/better-sqlite3）+ 修正 README | 依赖瘦身 |
| **P2** | 错误处理统一 + `save/load` 返回 `Result<T>` + logger | 调试效率 |
| **P2** | 前端监控 + 后端监控 | 线上可观测 |
| **P3** | E2E 测试 + 视觉回归 | 发布信心 |
| **P3** | CI/CD 流水线 | 自动化质量门 |

---

## 14. 与 v1 报告的差异说明

本版相对 v1（2026-07-28）的主要变化：

1. **新增后端专项评估**（第 9 节）：v1 几乎未评估后端，本次完整覆盖 7 个文件，发现 Swagger 缺失、限流缺失、虚假依赖、README 误导等问题；
2. **新增 `troopAnimation.ts` / `useAiOrchestrator.ts` 单文件过载**：v1 未提，本次标记为新热点；
3. **复核 v1 落地情况**（第 0.1 节）：明确 10 项已修复、10 项未修复；
4. **函数行数复核**：`applyEvent` / `executeOrder` 均较 v1 反增，标记趋势恶化；
5. **重构路线图新增 Phase 4（后端工程化）**：把后端 Swagger/限流/校验/超时/清理独立成阶段；
6. **优先级表新增「后端 Swagger」为 P0**：满足项目约定「后端接口同步到 Swagger 文档」。

---

*报告完。建议以 Phase 1（拆文件）+ Phase 4（后端工程化）双线并行起步：前端拆文件降维护成本，后端补 Swagger + 限流满足约定与安全基线。*
