# 战斗整轮原子提交

基线：`master` a24aac7。本次修复 `docs/ai-scheduler-review.md` 中的残留限制 3：战斗结算逐条调用 `applyEvent`，不是事务，所以只能保证最多一次（at-most-once）。

**说明**：以下结论来自代码阅读、本地 Vitest 和离线 40 回合经济基准。模型、动画和 toast 都是桩，没有调用真实模型，也不是真实浏览器实玩。

## 问题

旧版 `settleActiveBattles` 的问题：

- 第一阶段的前置检查在模型 await **之前**就逐条写入 live 世界，包括偷家溃散、无兵撤销、空城占领，以及随之而来的奖惩和威慑。
- 第三阶段在 await 之后逐条写入。中途一旦抛错，已经落地的战线不回滚，剩余战线在本日期也不再结算。
- 编排器在落地前就把 `battlesStarted` 置为 true，所以失败后重试会直接跳过战斗。

## 方案：同步回调事务 + 预演

### store（`apps/web/src/stores/game.ts`）

- `runTransaction` 是共用核心，复用已有的 `worldRefs` checkpoint、`batchEvents` 和 `isReplaying` 保护。`applyEvents` 改为基于它实现，对外语义不变。
- `transact(fn)`：`fn(apply)` 同步执行。全部成功后，本批事件一次性追加到 `eventLog`，返回 `{ events, notices }`。以下任一情况都会让世界态和日志整体回滚到调用前：
  - `apply` 落的事件被拒；
  - 调用方直接调用 `store.applyEvent` 且事件被拒（即使忽略了返回值），包括 reducer 内部的嵌套调用，例如 `auditFactionSurvival` 中的 `setFactionAlive`，由 `batchFailure` 记录；
  - 混入 `dateAdvance`；
  - `fn` 抛错；
  - `fn` 返回 thenable，即企图跨 await 持有事务。
- `simulate(fn)`：执行相同的同步过程，**结束后无条件回滚**，只返回计算结果。
- **按事务绑定的落地器**：每个事务发放的 `apply` 都绑定本批 `batchEvents` 的对象身份。旧落地器或晚到的落地器，在事务结束后调用，或在另一个新事务里调用，都会抛错，并让当前事务作废。
- **延后提示**：reducer 中的势力覆灭、天下一统、功业、西南战役完成等提示统一走 `notice()`。在 `transact` 里，提示会收集起来随结果返回，回滚时丢弃。在 `applyEvents` 或重放中，提示照旧静默；在普通 `applyEvent` 中，提示照旧立即弹出。
- 事务期间 `isReplaying=true`，因此不会自动存档，也不会弹提示。（自动存档本来只挂在 `dateAdvance` 上，而事务禁止混入它。）

**`simulate` 的限制**：它不是独立 draft。它在 live store 上同步改写，然后回滚，所以 `flush:'sync'` 的观察者可能看到中间态。现有的 sync 观察者已经核实，只监听 `reloadToken` 和 `currentFaction`，有 AdvisorPanel、PlayerAiPanel、useAiOrchestrator、useDiplomacyBus 和 useAgentKernel；CampaignPanel 的 sync watch 只看组件本地 ref。战斗事件不会改动这两个值，回滚时写回的也是相同的原始值，因此不会触发这些观察者。默认 pre/post flush 的 UI watcher 只在回滚之后运行，看到的值与之前相等。由于回滚写回的是深拷贝，对象身份会变化，深度 watcher（例如地图上的 `battleList`）可能用相同的值重同步一次。现有 `applyEvents` 失败回滚时本来就有这个特性。以后如果新增 sync watcher 监听城市、战斗等世界态，需要把预演改成独立 draft。

### 调度器（`apps/web/src/composables/useGameScheduler.ts`）

`settleActiveBattles` 的签名不变：

1. **推演**（`store.simulate`）：按战线顺序执行前置检查，并在推演态上计算本地公式和补给快照。后面的战线看到的是“前面战线的前置结果已经生效”的世界，与旧版逐条落地时完全一致。这样就不必把前置检查推迟到 await 之后、不经模拟直接执行，从而避免改变公式输入。
2. **AI 调味**（await）：await 前后都会调用 guard。期间 live 世界不含任何本轮战果。`aiStatus` 记录只是暂存，与战果同批提交；UI 回调 `onAiStatus` 仍然立即调用。
3. **提交**（`store.transact`）：在最新的 live 世界上按原顺序重放前置检查，再写入 `aiStatus`，然后按快照公式和钳制后的调味逐条战线落地，并重验战线存活、双方归属和攻方兵力。战线、占领、奖惩、士气、撤退、势力存亡审计和终局复检同在一批。日志顺序与旧版一致：前置事件 → aiStatus → 公式战线事件。基础公式和补给沿用第 1 步的快照，不在 await 后重算。
4. **演出**（提交后 best-effort）：先同步调用 `onCommit`，再停止战线动画、弹出战果 toast 和 reducer 延后的提示。每一项都单独 try/catch，失败只告警，不回滚战果。
5. 同一时间只允许一轮结算（模块级 `settlingBattles`），防止两次并发结算各自 await 之后重复提交。

**目标易主的空城**：守方兵力为 0，但目标已经不归原守方（被第三方或同盟接管）时，推演和提交两个阶段都撤销战线（`retreat`），不再按旧战线占领第三方。目标易主但仍有守军的情形保持原语义，由提交阶段的重验撤销。见下文基准结果。

### 编排器（`apps/web/src/composables/useAgentKernel.ts`，只改战斗阶段）

- `onCommit` 现在在原子提交**成功之后**才把 `battlesStarted` 置为 true。推演、调味或提交中任一环节失败，都不会留下本轮战果，回合进入 `failed`，重试时整轮重打。
- 日志兜底：如果本回合起点（`turnStartIdx`）之后已经有 `attack` 事件，就视为本轮战斗已结算。`attack` 只由整轮原子提交产生。

## 保证范围

- **原子性**：单次 `settleActiveBattles` 的全部战果要么整体提交，要么完全不落地，世界和 eventLog 都是如此。
- **恰好一次**：限于编排器的正常入口 `endPlayerTurn` / `runWorldTurn`。每个日期的战斗，失败后重试会补打，提交成功后不会重打。没有运行时断点时，由 `recoverFromLog` 和 `attack` 日志兜底。
- **不是全局幂等**：直接、串行地多次调用 `scheduler.settleActiveBattles()`，每次都会再打一轮。离线基准和测试依赖这种行为，调试面板也可以这样调用。

## 测试

新增 `apps/web/src/__tests__/battleAtomicSettlement.spec.ts`，共 20 项。失败注入使用 `vi.spyOn(store, 'transact')` 包裹落地器，生产代码中没有测试钩子；`afterEach` 中调用 `vi.restoreAllMocks()`。

- **store**：
  - 提交成功；
  - 调用方忽略返回值的被拒事件仍使整批回滚；
  - dateAdvance、thenable 或抛错都会回滚；
  - 旧落地器在事务结束后，以及在新的提交或预演事务中都会被拒；
  - 嵌套的势力存亡审计纳入同批，覆灭提示延后到提交后，失败时一并回滚；
  - 预演回滚后，默认 flush 的 watcher 看不到中间态。
- **调度器**：
  - 两条战线一次提交，演出在 `onCommit` 之后；
  - await 期间 live 世界与调用前完全相等，包括前置检查的占领；
  - 提交末尾注入失败时，多战线全部回滚，不出现 toast、动画、onCommit 或 aiStatus，之后可再结算恰好一次；
  - 中途非法事件导致第一条战线已落地的部分一并回滚；
  - 晚到的调味结果（guard 失效）不触发提交；
  - 空城目标在 await 期间易主时撤销战线，不占领第三方；推演阶段同样不占领；
  - 视觉或提示失败不回滚战果；
  - 并发结算被拒。
- **编排器**：
  - 提交失败进入 `failed`；重试后每条战线一轮、只收税一次、日期只推进一次、只请求一次决策；
  - 战后失败（电报写入抛错）后重试不重打；
  - 演出失败时回合照常提交；
  - 丢弃断点后，日志兜底同样不重打。

## 验证结果

均在冻结后的源码上执行，Node 24.21.0。

- `vue-tsc --noEmit`：通过。
- `oxlint`，覆盖 3 个核心文件、新增战斗测试及游戏性审计文件：0 警告，0 错误。
- 前端全量回归（显式设置 `MAPWAR_GAMEPLAY_AUDIT_OUT`，`--maxWorkers=2 --testTimeout=15000`）：59 个文件中 56 个通过、3 个跳过；652 项通过，4 项真实模型相关测试跳过；没有失败或未处理异常。`supply`、`schedulerRewards` 和 `turnRuntime` 的断言没有修改。未启用审计时，它另行跳过。
- 后端离线回归再次执行：42 项通过。根目录 `pnpm build` 通过，包含 Vue 类型检查、Vite 与 Nest 构建；主包大于 500 kB 的提示仍存在。
- **离线 40 回合经济基准**（`MAPWAR_BENCHMARK_OUT`，4800 行）与固定的 a24 基线比较：
  - 当前版本：4800 行中有 655 行不同，全部来自 `reserve-aware` 策略的 1931、1942、2026 三个种子，分别为 97、315、243 行。
  - **消融实验**：在独立副本中只关闭“目标易主的空城不占领”这一条判断，其余事务代码不变，再运行完整矩阵；结果与基线的 JSON 和 CSV **逐字节一致**。本次矩阵中事务重构没有引入其他战果差异，655 行变化来自这条防护：旧版会按旧战线直接占领已被第三方或同盟接管的空城。最终代码保留防护，不含临时关闭判断。

对玩法的影响：基础公式、奖惩、补给和威慑规则都没有改。但由于修正了非法占空城，从首个触发点开始（`reserve-aware` 种子 1931 第 19 回合，CCP：captures 从 2 降为 1，士气从 90.8 降为 87.2），旧基线中的后续结果（财政、战局）可能不同，不能声称与旧版逐行等价。最终矩阵 reserve-aware 为 163 次欠饷势力回合、1537 条新开战线、1085 次占领事件，缺粮为 0；它们不是模型胜率或玩家体验指标。

可复现的命令见 `gameplay-review.md`。本轮另在最终代码上运行 60 个真实引擎战斗用例，其结果与 a24 基线一致；这是守方 5k、固定士气与距离、无模型调味及干预的受控网格，不是全参数平衡性证明。
