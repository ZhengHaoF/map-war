# 烽火舆图 · 项目重构评估报告

> 生成日期：2026-07-28  
> 范围：全仓通读 `../../apps/web/src` + `../../apps/server/src/ai` + 关键 `..` 设计文档  
> 方法：静态分析 + 架构比对 + 技术债务盘点

---

## 1. 总体结论

项目当前处于**「设计领先、落地 partially、工程债累积」**的阶段：

- ✅ 架构设计文档详尽，核心决策（Kernel 唯一写者、事件溯源、P1-P4 回合流、电报/顾问/事件日志）**已落地或部分落地**；
- 🟡 前端单文件过载严重，`LeafletMap.vue` / `gameOrders.ts` / `game.ts` 三文件合计 **超 3000 行**，职责边界模糊；
- ⬜ 测试覆盖率低、类型安全靠 `as` 断言桥接、性能热点未量化、内存泄漏风险未系统排查。

**建议优先级**：先拆文件（可读性）→ 补测试（安全网）→ 修性能（体验）→ 上监控（可观测）。

---

## 2. 架构健康度

### 2.1 已对齐的设计（ Strengths ）

| 设计决策 | 落地状态 | 证据 |
|---|---|---|
| 权威态在前端，后端仅 LLM 透传 | ✅ | `ai.service.ts` 纯 `chat.completions.create` 转发 |
| Kernel = 唯一写者（`applyEvent`） | ✅ | `game.ts` `applyEvent`  reducer，无直接改 store 后门 |
| 事件溯源 + replay | ✅ | `eventLog` 持久化到 localStorage，`load()` 逐事件重放 |
| 兵力/士气下沉到城市级 | ✅ | `CityState.troops/morale`，`factionTroops/factionMorale` 派生 |
| P1-P4 回合流水线 | 🟡 | `useAgentKernel.runWorldTurn` P2/P3/P4 已通，缺外交总线与规则 AI 兜底 |
| 电报 / 顾问 / 事件日志面板 | ✅ | `TelegramPanel` / `AdvisorPanel` / `EventLogPanel` 均已落地 |
| 城市邻接图注入 AI 上下文 | ✅ | `chinaCitiesAdjacent.ts` + `aiContext.ts` `buildFactionContext` |
| 动画与状态分离 | ✅ | `troopAnimation.ts` 纯视觉，`gameOrders.ts` 编排，`applyEvent` 落库 |

### 2.2 架构债务（ Architectural Debt ）

| 问题 | 风险 | 建议 |
|---|---|---|
| `LeafletMap.vue` 单文件 2000+ 行，混了地图渲染、UI 状态、相机控制、战��卡片、右键菜单、模态框 | 维护困难，改地图渲染容易误伤 UI | 拆分为 `MapRenderer` / `MapCamera` / `BattleCardLayer` / `MapUiOverlay` 等子组件 |
| `gameOrders.ts` 1000+ 行， giant switch + 模块级可变状态 | 新增指令成本高，重入锁 `locks` 易遗漏 | 拆为 `orders/` 目录，每指令一个文件；引入 `OrderRegistry` 类管理锁与注册表 |
| `game.ts` store 800+ 行， reducer + 存档 + 电报 + 派生聚合全塞在一个文件 | 类型改动影响面大，`applyEvent` 单函数 150 行 | 拆为 `game.reducer.ts` + `game.save.ts` + `game.telegram.ts` + `game.selectors.ts` |
| 模块级单例（`useGameScheduler` / `useAgentKernel`）用 Vue `ref` 持有，无清理机制 | HMR / 热重载时状态残留，测试隔离困难 | 改为类单例或提供 `dispose()`， composable 只做门面 |
| `gameOrders.ts` 模块级 `_container/_camera/_app` 可变全局 | 多实例（未来双地图） Impossible，测试需 mock 全局 | 改为 `GameOrdersEngine` 类，通过 inject / provide 传递 |

---

## 3. 代码质量与可维护性

### 3.1 类型安全

| 问题 | 示例 | 影响 |
|---|---|---|
| 大量 `as` 断言桥接 | `(c.owner as Owner) ?? Owner.NEUTRAL`、`(OWNER_COLORS as Record<string, number>)[key]` | 掩盖真实类型不匹配，重构时易爆 |
| `CityState` 字段 `fieldForce` 用 `(c as unknown as Record<string, unknown>).fieldForce` 绕过 TS | `game.ts` `initWorld` | 应直接在 `CityState` 接口声明 `fieldForce` |
| `GameEvent` 联合类型未加 `id` 公共字段 | replay / 调试时难以追踪单条事件 | 建议加 `id?: string` 可选字段 |
| `Telegram` 缺 `sentAt` 时间戳 | 无法按时间精确排序，仅靠 `turn` 近似 | 补 `sentAt: number` |
| `SaveData` 有 `version` 但无迁移逻辑 | 未来 schema 变更时老存档全废 | 加 `migrate(v1)` 函数 |
| `BattleInfo` 的 `lastNarrative` 可能未定义 | UI 渲染时需反复判空 | 给默认值 `''` 或可空类型显式标注 |

### 3.2 函数复杂度

| 函数 | 行数 | 问题 | 建议 |
|---|---|---|---|
| `applyEvent` | ~150 | giant switch + 前置校验 + 事件解析 + 状态突变 | 拆为 `preCheck` + `applyCityEvent` + `applyMetaEvent` |
| `executeOrder` | ~260 | giant switch + 重复的 `resolveLocationId` + 重复 toast | 拆为 `OrderExecutor` 策略类，每指令一个 `executeXxx` |
| `preCheck` | ~60 | 每个 case 重复 `resolveLocationId` | 提取 `resolveAndCheck` 工具 |
| `buildFactionContext` | ~80 | 遍历 `store.cities` + 邻接表 + 历史 + 电报，多次 `getSnapshot` | 缓存 `snap`，一次性遍历 |
| `runExecuteFreeAction` | ~90 | switch 内重复 `store.applyEvent` | 提取 `applyFreeEffect(eff)` |
| `syncBattleCards` | ~30 | 每帧调用，内层循环 + 碰撞检测 | 抽为 `BattleCardLayout` 类 |

### 3.3 命名与一致性

| 问题 | 现状 | 建议 |
|---|---|---|
| `factionTroops(o)` 是函数，`myStats` 是 computed | API 不一致 | 统一为 `factionTroops` computed / selector |
| `cityOwner(gb)` 函数 vs `ownership` computed | 并存但语义重复 | 保留 `ownership`，`cityOwner` 改为 `getOwner(gb)` |
| `playTimeJump` 同时做云雾 + 日期推进 + toast | 职责过载 | 拆为 `playCloudTransition` + `applyDateAdvance` + `notifyDateJump` |
| `needsPlayerDecision` 挂在 `GameOrder` 而非 `GameEvent` | replay 时不保留 | 迁到 `GameEvent` 或单独 `PlayerDecisionEvent` |
| `ORDER_TYPES` 常量数组 vs `OrderType` 类型 | 两处定义，容易漂移 | 用 `satisfies` 或 `as const` 保证单一真相源 |

---

## 4. 性能热点

### 4.1 已识别的热点

| 热点 | 位置 | 复杂度 | 影响 |
|---|---|---|---|
| `ownership` computed | `game.ts` | O(N) 每帧 | 每次访问都 `Object.fromEntries(Object.entries(...))` |
| `factionTroops(o)` / `factionMorale(o)` | `game.ts` | O(N) 每调用 | AI 上下文每回合调用多次 |
| `myStats` computed | `game.ts` | O(N) + sort | 每次 `currentFaction` 变化重算 |
| `buildFactionContext` | `aiContext.ts` | O(N) + 邻接遍历 | P3 每势力每回合调用 |
| `buildEventHistory` | `aiHistory.ts` | 可能 O(N^2) | 未确认实现，需 review |
| `loadLayer` | `LeafletMap.vue` | O(M features) | `ownership` watcher 每次易主都全量重绘 |
| `syncBattleCards` | `LeafletMap.vue` | O(B²) 碰撞检测 | 每帧调用（拖拽/缩放/镜头演出） |
| `drawFeature` / `highlightOn` | `LeafletMap.vue` | O(vertices) | 每次 `loadLayer` 重建 Graphics |
| `pointInPolygon` | `LeafletMap.vue` | O(ring length) | 点击测试遍历所有 feature |
| `getSnapshot` | `game.ts` | O(N) 深拷贝 | 每回合 P2/P3 各调用至少一次 |

### 4.2 优化建议

1. **缓存派生值**：`ownership` 改为 `shallowRef`，在 `applyEvent` 变更时局部更新，而非 computed 全量重建；
2. **debounce `loadLayer`**： ownership watcher 加 100ms debounce，避免连续易主时连续重绘；
3. **空间索引**：点击测试用 RBush / R-tree 替代遍历，`pointInPolygon` 只在候选 bbox 内做；
4. **battleCardPos 节流**：`syncBattleCards` 在拖拽期间降频（如每 3 帧），静止时全频；
5. **`getSnapshot` 增量**：P3 并行 LLM 前只取一次 snap，传入所有 faction context，避免重复调用；
6. **`formatCityCompact` 缓存**：城市描述字符串在单次上下文构建中多次拼接，可缓存到 `Map<gb, string>`。

---

## 5. 内存与资源管理

| 风险点 | 现状 | 建议 |
|---|---|---|
| PixiJS `Application` / `Container` 销毁 | `onUnmounted` 调 `app.destroy(true)`，但事件监听器手动移除不完整 | 用 `app.destroy(true, { children: true, texture: true })`，或封装 `usePixiApp` composable 统一管理生命周期 |
| `battleRegistry` / `activeBattles` 模块级 Map | `resetBattleRuntime` 清空，但异常路径（如组件销毁）可能遗漏 | 暴露 `dispose()`，`LeafletMap.onUnmounted` 调用 |
| `geoJsonCache` 无限增长 | `loadLayer` 只进不出，切换多图层后内存持占 | 加 LRU 上限（如 5 个图层）或 `onUnmounted` 清空 |
| `undoStack` 无上限 | `useAiOrchestrator` 每步执行前 push，长期运行可能 OOM | 加 `MAX_UNDO = 50`，超限 shift |
| `chatTurns` 无上限 | 多轮对话无限累积 | 加 `MAX_CHAT_TURNS = 20` |
| `telegrams` 数组无限增长 | 每回合 P3/P4 追加，长期运行内存增长 | 加 `MAX_TELEGRAMS = 500` 或按 turn 归档 |
| `eventLog` 无限增长 |  replay 必需，但前端 localStorage 有 5MB 上限 | 加 `MAX_EVENTLOG = 2000`，超限压缩早期事件；或后端存储 |
| `playCloudTransition` 临时 Graphics / Texture | `cloudTransition.ts` 未显式销毁 | 确保 `disposeCloudTransition` 清理所有临时资源 |
| `troopAnimation.ts` RAF 未取消 | 组件销毁时动画 RAF 仍在跑 | `resetBattleRuntime` 已 cancel，但需确认所有动画路径都走注册表 |

---

## 6. 错误处理与可观测性

| 问题 | 现状 | 建议 |
|---|---|---|
| `applyEvent` preCheck 失败仍 push `eventLog` | replay 安全，但日志噪音大 | 加 `rejected: boolean` 标记，UI 可选择性显示 |
| `executeOrder` catch 后 push toast「指令出错」但无原始错误 | 调试困难 | toast 开发模式下附带 `error.message` |
| `invokeFactionAI` / `invokeWorldAIBatch` LLM 失败仅 toast | 无结构化错误上报 | 加 `lastError` 字段，`AiDebugPanel` 可查看原始 err |
| `load` 读档失败静默返回 `false` | 调用方不知道原因 | 抛错或返回 `{ ok: false; reason: string }` |
| `save` 失败静默返回 `false` | 同上 | 同上 |
| 无前端日志分级 | `console.log` / `console.warn` / `console.error` 混用 | 引入 `logger` 工具，按 `DEBUG / INFO / WARN / ERROR` 分级，生产环境可开关 |
| 无前端监控 | 异常、LLM 延迟、动画帧率均无采集 | 接入 Sentry / 自建 `monitor` 模块，采集 `llmDuration` / `orderExecuteDuration` / `battleCount` |
| LLM 调用无超时 | `useLlmClient.ts` 仅 retry，无 timeout | 加 `AbortSignal.timeout(30000)`，超时后 fallback |

---

## 7. 安全性与输入验证

| 问题 | 现状 | 建议 |
|---|---|---|
| 后端 `ai.service.ts` 无请���频率限制 | 任一前端可无限调用，账单风险 | 加 `@nestjs/throttler` 或自定义限流（每 IP 每用户 100 次/分） |
| 后端无请求体大小限制 | LLM 上下文可能极大 | 加 `nestjs/multer` 或 `app.use(express.json({ limit: '1mb' }))` |
| 前端 `playerName` 无 XSS 过滤 | 直接 `v-html` 或 `innerText`？需确认 | 确保所有用户输入走 Vue 模板插值（自动转义），禁止 `v-html` |
| `chinaCities.seed.json` 若来自用户上传 | 无 schema 校验 | 加 `zod` / `ajv` 校验，防止注入畸形数据 |
| `localStorage` 存档无签名 | 玩家可手动修改存档 JSON | 加简单 HMAC（存于内存 key），检测篡改；或仅校验 JSON schema |
| DeepSeek API Key 仅存后端 `.env` | ✅ 已做 | 保持，禁止前端传 key |

---

## 8. 测试覆盖缺口

### 8.1 已有测试

| 文件 | 覆盖范围 |
|---|---|
| `aiContext.spec.ts` | 上下文构建 |
| `aiOrderContract.spec.ts` | 指令校验 |
| `llmClient.spec.ts` | LLM 客户端 |
| `gameStore.spec.ts` | store 基本操作 |
| `aiHistory.spec.ts` | 历史装配 |

### 8.2 缺失的关键测试

| 模块 | 优先级 | 建议用例 |
|---|---|---|
| `game.ts` `applyEvent` | P0 | 每条 `GameEvent` 的 happy path + preCheck 拦截 + replay 等价性 |
| `game.ts` `save/load` | P0 | 多槽位、老存档兼容、损坏存档容错 |
| `gameOrders.ts` `executeOrder` | P0 | 每指令的动画 mock + world state 验证 |
| `useGameScheduler.ts` | P0 | `submit` + `advance` + `needsPlayerDecision` 停点 + 异常跳过 |
| `useAgentKernel.ts` | P1 | `endPlayerTurn` 四阶段 mock LLM + 失败 fallback |
| `aiInvoke.ts` | P1 | `invokeAgentDecision` 解析成功/失败/重试 |
| `aiClassify.ts` | P1 | `classifyFactions` 边界条件（无历史、全相关、全无关） |
| `locationResolver.ts` | P1 | 中文名 / gb 编码 / alias 解析 |
| `LeafletMap.vue` | P2 | 点击测试、相机补间、图层切换（可用 `@vue/test-utils` + `jest`） |
| `TelegramPanel.vue` | P2 | 频道切换、未读角标、发送/接收 |
| `AdvisorPanel.vue` | P2 | 建议点击填充到 PlayerAiPanel |
| `EventLogPanel.vue` | P2 | 自动滚动、事件过滤 |

### 8.3 测试基础设施

- 缺 **E2E 测试**（建议 Playwright，覆盖「开局 → 选势力 → 玩家指令 → 结束回合 → 世界推演 → 读档」主流程）；
- 缺 **视觉回归测试**（PixiJS 地图渲染输出截图对比，防止配色/标注意外漂移）；
- 缺 **AI 契约一致性测试**（固定 fixture → 调用 LLM → 验证返回 JSON 符合 `aiOrderContract`  schema）。

---

## 9. 安全与合规

| 项 | 状态 | 说明 |
|---|---|---|
| 地图数据合规 | ⚠️ 需确认 | `LeafletMap.vue` 免责声明已声明数据来源，但 `chinaCities.seed.json` 若含边界线需确保符合自然资源部标准 |
| API Key 管理 | ✅ | 仅存后端 `.env`，前端零硬编码 |
| 前端 XSS | ⚠️ 需审计 | 检查所有 `v-html` / `innerHTML` / `document.write` 使用 |
| 存档篡改 | ⚠️ | localStorage 无签名，玩家可修改；若涉及排行榜/分享需加签 |
| LLM  Prompt 注入 | ⚠️ | 玩家输入经 world AI 校验，但 `PLAYER_AI_UNIFIED_PROMPT` 未做输入消毒；需确认 world AI 能抵御 jailbreak |
| 依赖漏洞 | ❓ | 需跑 `pnpm audit` 检查 `better-sqlite3` / `openai` / `pixi.js` 等已知 CVE |

---

## 10. 依赖与构建

| 问题 | 现状 | 建议 |
|---|---|---|
| TS 5.7.3 锁定，不升级 7.x | 因 `vue-tsc` 不兼容 | 关注 `vue-tsc` 2.x 或 `typescript-eslint` 新版，适时升级 |
| `pixi.js` 8.19.0 | 使用较新版本，API 稳定 | 锁版本，避免自动升级破坏渲染 |
| `unplugin-icons` + `@iconify-json/tabler` | 已接入 | 保持，图标零运行时体积 |
| `pnpm` workspace | 单仓多包 | 保持，考虑加 `pnpm.onlyBuiltDependencies` 防止原生模块冲突 |
| `better-sqlite3` 原生模块 | `.npmrc` 已放行 | 保持，注意 CI 环境需装 build 工具 |
| 无 CI/CD | ❓ | 建议加 GitHub Actions：`pnpm typecheck` + `pnpm build` + `pnpm test` |

---

## 11. 重构路线图（建议）

### Phase 1：文件拆分（1-2 天，风险低，收益高）

1. **拆 `LeafletMap.vue`**
   - 提取 `MapCamera.ts`（相机状态 + `animateCameraTo` + `applyCamera`）
   - 提取 `BattleCardLayer.vue`（战斗卡片 DOM 层）
   - 提取 `MapContextMenu.vue`（右键菜单）
   - 提取 `MapModals.ts`（信息模态、调试模态、战斗列表模态）
   - 目标：主文件降至 800 行内

2. **拆 `gameOrders.ts`**
   - 拆为 `orders/arrow.ts`、`orders/battle.ts`、`orders/capture.ts`、`orders/city.ts`（内政）、`orders/meta.ts`（dateAdvance / factionAlive）
   - 引入 `OrderRegistry` 类封装 `battleRegistry` / `activeBattles` / `locks`
   - 目标：`executeOrder` 降至 150 行内

3. **拆 `game.ts` store**
   - `game.reducer.ts`：`applyEvent` + `preCheck` + `GameEvent` 类型
   - `game.save.ts`：`save/load/deleteSave/listSaves` + `SaveData` 接口
   - `game.telegram.ts`：`Telegram` 接口 + `pushTelegram` + `unreadCount`
   - `game.selectors.ts`：`myStats` / `factionTroops` / `factionMorale` 等派生
   - 目标：`game.ts` 降至 300 行内，只导出 `useGameStore`

### Phase 2：类型安全与测试（2-3 天）

4. **消灭 `as` 断言**
   - `CityState` 显式声明 `fieldForce: number`
   - `OWNER_COLORS` 索引用 `Record<string, number>` 已做，检查剩余 `as Owner` 处
   - `GameEvent` 加 `id?: string`，`Telegram` 加 `sentAt: number`

5. **补核心测试**
   - `applyEvent` 全分支单测
   - `executeOrder` 每指令单测（mock 动画）
   - `save/load` 单测（localStorage mock）
   - `useGameScheduler` advance 单测

6. **加测试基础设施**
   - `vitest` 配置（若未全量迁移）
   - `@testing-library/vue` 组件测试
   - `playwright` E2E 主流程

### Phase 3：性能优化（1-2 天）

7. **优化高频路径**
   - `ownership` 改 `shallowRef` + 局部更新
   - `buildFactionContext` 单次 `getSnapshot` + 缓存城市描述
   - `loadLayer` debounce 100ms
   - `syncBattleCards` 拖拽时降频

8. **内存治理**
   - `undoStack` / `chatTurns` / `telegrams` / `eventLog` 加软上限
   - `geoJsonCache` 加 LRU
   - `disposeCloudTransition` 确保清理

### Phase 4：工程化（1-2 天）

9. **错误处理统一化**
   - 引入 `logger` 工具
   - `save/load` 返回 `Result<T>` 而非 boolean
   - LLM 调用加 `AbortSignal.timeout`

10. **可观测性**
    - 前端监控：LLM 延迟、指令执行时长、战斗数量、内存使用
    - 后端限流：`@nestjs/throttler`

11. **CI/CD**
    - GitHub Actions：typecheck → lint → build → test

---

## 12. 风险与注意事项

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 拆文件时遗漏模块级状态引用 | 中 | 运行时 crash | 拆前用 `grep` 列出所有引用点，拆后逐一核对 |
| 修改 `applyEvent` 导致 replay 不一致 | 低 | 存档损坏 | 改前必写单测， replay 用例固定 seed |
| `ownership` 改 `shallowRef` 后 watcher 不触发 | 中 | 地图不更新 | 明确触发时机：`applyEvent` 末尾手动 `triggerRef` |
| LLM 调用超时导致 P3/P4 卡死 | 中 | 玩家体验差 | 加 30s timeout + fallback 叙事 |
| `better-sqlite3` 在 CI 环境构建失败 | 中 | 流水线挂掉 | CI 加 `apt-get install -y libsqlite3-dev` |

---

## 13. 优先级总结

| 优先级 | 事项 | 预期收益 |
|---|---|---|
| **P0** | 拆 `LeafletMap.vue` + `gameOrders.ts` + `game.ts` | 可维护性飙升，新人上手成本骤降 |
| **P0** | 补 `applyEvent` + `executeOrder` + `save/load` 核心测试 | 重构安全网，避免回退 |
| **P1** | 消灭关键 `as` 断言 + 补 `Telegram.id / sentAt` | 类型安全，减少运行时 surprise |
| **P1** | `ownership` 改 `shallowRef` + `loadLayer` debounce | 地图渲染帧率稳定 |
| **P1** | 内存上限 + LRU 缓存 | 长局不 OOM |
| **P2** | 错误处理统一 + logger | 调试效率 |
| **P2** | 前端监控 + 后端限流 | 线上可观测 |
| **P3** | E2E 测试 + 视觉回归 | 发布信心 |
| **P3** | CI/CD 流水线 | 自动化质量门 |

---

*报告完。建议以 Phase 1 为第一步，先拆文件，再补测试，再优化。*
