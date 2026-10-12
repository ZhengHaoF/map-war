# map-war AI 调度引擎修复与深审报告

范围：`apps/web/src/composables/useAgentKernel.ts`、`apps/web/src/composables/useGameScheduler.ts` 及相关测试。本次复审由 Claude Opus 5.5 辅助完成，并与 store、指令层、存档、外交及后端修复统一集成验证。

**说明**：以下全部结论来自代码阅读与本地 Vitest 实验。模型、动画与时间跳跃均为可控桩，未调用真实模型或 API，**不是真实浏览器实玩，也没有评价模型决策质量**。

---

## 结论

- **原问题已经证实，并已修复**：世界回合会忽略调度器返回的 `'stopped'`，继续进行战斗、叙事和日期推进；暂停时，日期指令因移到局部数组而丢失；遗留的世界指令会留在公共队列，导致玩家下一次推进时被顺带执行。
- **主要改动**：回合运行时现在是一个可恢复的阶段状态机（`TurnProgress`）。每个日期“只收税一次、只推进日期一次”，现在由运行时断点保证，同时以 eventLog 作为兜底判断，不再只靠调用约定。
- **整体判断**：不需要重写，但回合运行时仍是模块级单例，而且与 Pinia store 及演出耦合。中期建议见下文的架构评价。

## 已修问题与对应代码

### 调度器 `useGameScheduler.ts`

| 问题 | 修复 | 位置 |
|---|---|---|
| 日期指令先被移出队列，停在玩家决策点后就丢失 | 日期指令暂存在本地；遇到停点、guard 失效或异常时，`finally` 会把未提交的日期指令放回队尾。日期指令先查看、提交成功后才出队 | `advance()` 约 499–590 行 |
| 外层 `catch {}` 把任何异常都当成 `'done'` | 删除这种吞错处理。出现异常或 guard 失效时，状态复位为 `idle`，错误继续向上抛出，未执行项保留在队列中 | `advance()` 的 `finally` |
| 跨 await 后，旧会话仍可能写入回执或停点 | 新增 `AdvanceOptions.guard`：每条指令执行前检查一次；`await executeOrder` 之后也检查一次，且这次检查放在 catch 外，不会被指令错误吞掉 | 约 518、550 行 |
| 时间跳跃演出失败时日期可能没提交；中点提交后再出错可能重复提交 | `commitDate()` 检查本次是否已追加相同日期的 `dateAdvance`，只有缺失时才补记。guard 错误不会被当成演出失败吞掉。`playTimeJump(date, guard)` 由父代理加入 guard | `commitDate()` 约 469 行 |
| 暂停后的世界剩余指令无法安全移出或恢复 | 新增 `detachQueue()` / `restoreQueue()`，按 `{order, context}` 原样移出和放回队列 | 约 448–463 行 |
| 默认上下文为 `{}`，换势力后执行身份会随之改变 | `submit()` 在入队时锁定身份：未声明权限的指令视为 `authority:'player'`，并固定 `actor` 为入队时的当前势力。这与 `checkLiveOrder` 对未声明权限的原有语义一致 | `submit()` 63 行 |
| 战斗结算跨调味模型 await 后没有重验 | `settleActiveBattles(..., guard, onCommit)`：await 前后和调味回调中都会调用 guard；落地前逐条重验战线是否仍有效、攻方归属、守方归属和前线兵力，守方易主时撤销该战线 | 约 75–300 行 |

战斗基础公式和补给判断仍使用第一阶段快照，也就是发给调味模型的同一份快照，不在 await 后重新计算。`supply.spec` 明确要求这一语义，我曾短暂改成重新计算，后已撤回。

### 编排器 `useAgentKernel.ts`

- **显式回合会话**：阶段为 `drain → tick → ai → execute → battles → settlement → date → committed`。对外状态 `turnState` 为 `idle | planning | executing | awaiting-player | settling | committed | failed`。`endPlayerTurn()` 和 `runWorldTurn()` 现在返回该状态。
- **awaiting-player**：调度器返回 `'stopped'` 时，编排器把剩余项从公共队列取回会话，并锚定到 `pauseForPlayer` 事件，然后结束本次调用：`loading=false`，不进行战斗、叙事或日期推进。玩家再次 `endPlayerTurn()` 时，从断点继续执行，不重复收税，也不重新请求模型（见 `runQueued` / `pauseForPlayer` / `performWorldTurn`）。
- **暂停中的玩家操作**：世界剩余项不留在公共队列，所以 `commandBusy` / CampaignPanel 不会被卡住，玩家的推进也不会顺带执行 AI 指令。恢复时，断点剩余项排在玩家新排入的指令之前。
- **只收税一次**：只有 `taxedThisDate()` 判断“最后一次 dateAdvance 之后没有 economicTick”时才收税。
- **只推进日期一次**：断点锚点之后已有 `dateAdvance` 时不再推进日期。日期由 `nextTurnDate` 钳制，`advance` 若返回 `running` 或 `stopped`，或日期最终未改变，均按失败处理。
- **世界代次**：断点有效的条件是“`eventLog[anchorIndex]` 仍是同一个事件对象，且势力和日期一致”。读档和 `initWorld` 都会替换 eventLog 里的对象，因此旧断点会失效。世界被取代时，会话作废，公共队列也会清空，旧世界的指令不会在新世界执行。
- **故障恢复**：非取代类异常进入 `failed`，并保留断点，包括从调度器取回的未执行项；重试时从断点继续。战斗阶段使用 `onCommit` 语义：调味返回、战果开始同步落地前才标记 `battlesStarted`。调味阶段失败时没有战果落地，重试会完整打这一轮；落地中途失败则不重跑，**只保证最多一次（at-most-once），不是恰好一次**，见残留限制 3。
- **没有运行时断点的兜底**：例如暂停时 `store.save` 未带快照，或旧版本失败后重试。`recoverFromLog()` 发现“本日期已收税但未推进日期”时，进入只结算模式：不再收税，也不再请求决策，只完成战斗、叙事和日期。是否已完成世界总结，只根据显式标记 `narrative.scope === 'world-turn'` 判断，外交收口叙事不会被误认。无标记的旧存档会重做总结，但不会跳过战斗。
- **截止时间**：同一会话内的所有模型等待共用一个截止时间（`startWaitDeadline` 只启动一次）。暂停后恢复是新会话，会重新获得一个截止时间。
- **启动前检查**：调度器正在推进时拒绝开始回合，不会把 `'running'` 当成完成。

### 对外接口

```ts
// useGameScheduler()
advance(options?: { guard?: () => void }): Promise<'done' | 'stopped' | 'running'>
detachQueue(): QueuedOrder[]            // 推进中调用会抛错
restoreQueue(entries: QueuedOrder[]): void
settleActiveBattles(llmOpts?, onAiStatus?, onAiWaiting?, guard?, onCommit?)
export interface QueuedOrder { order: GameOrder; context: ExecutionContext }

// useAgentKernel()
endPlayerTurn() / runWorldTurn(): Promise<TurnRuntimeState>
turnState: Ref<TurnRuntimeState>; awaitingPlayer: Ref<boolean>
exportPendingTurn(): PendingTurnSnapshot | null     // 存档时附带
importPendingTurn(s): boolean                       // 读档成功后调用，非法或不一致时返回 false
discardPendingTurn(): void
export interface PendingTurnSnapshot { version: 1; faction; baseDate; anchorIndex; anchorType;
  turnStartIdx; ownership; stage; remaining: QueuedOrder[]; orderCount; battlesStarted; newDate? }
```

统一接入：`SaveData.pendingTurn`（只做类型引用，没有运行时循环依赖）；`useSaveGame` 保存时调用 `export`，读档时在 `requestMapReload` 后调用 `import`。编排器另向 store 注入只读快照提供器，直接 `store.save` 的自动存档及外交存档也携带暂停断点。

`importPendingTurn` 会先调用父代理的纯形状校验 `isPendingTurnSnapshot`，再由编排器检查与当前世界是否一致：锚点类型、日期、势力、锚点后没有日期推进、`execute` 阶段必须已经收税。存档可以被玩家编辑，因此只接受 `player` / `faction` 权限，拒绝 `system` / `debug` 和 `setCurrentDate`；导入后执行时仍经过 `executeOrder` 全量重验。

## 残留限制

1. **旧存档没有暂停快照**：历史存档或明确传入 `pendingTurn:null` 的存档仍只能按日志兜底。不重复收税、不重复决策，但从未落日志的剩余指令无法恢复。当前自动存档及外交存档的遗漏已通过运行时 getter 注入修复。
2. **结算中不保存断点**：进行中的回合不导出未完成的运行时快照；UI 在世界结算期间禁止手动保存，日期提交后的自动存档包含已完成的世界日志。
3. **【未解决的结构项】逐战线结算不是事务**：战果落地是逐条 `applyEvent`，只保证最多一次（at-most-once），不保证恰好一次（exactly-once）。若在 `onCommit` 之后的落地过程中抛出异常，已落地的战线不会回滚，剩余战线在本日期也不再结算，重试时会直接跳到叙事和日期（`useGameScheduler.ts` 中 `onCommit?.()` 处，以及 `useAgentKernel.ts` 中 battles 阶段的注释）。根治需要把整轮战斗计算为 `EventBatch`，再经 `applyEvents` 原子提交，或者改为按战线 id 记录已提交集合。
4. **暂停与恢复的语义**：恢复的 AI 指令是暂停前根据旧局势做出的决策。执行时会重新通过规则门卫，但不会重新规划。
5. **身份与代次检查还不统一**：世界代次靠锚点事件对象身份推断，store 没有显式的 `worldGeneration`。`ensureCurrent` 使用 reloadToken、势力和 signal，断点使用锚点身份，两套判据并存。
6. **取消不等于供应商退款**：本次后端已实现响应连接断开时向上游传递取消信号；离线 HTTP 测试验证了传播。供应商收到取消之前已执行或计费的工作不能由客户端保证撤销，也未做真实供应商验证。
7. **模块级单例**：调试面板仍可直接 `advance()`，并恢复调度器层面的 `'stopped'` 队列。这只用于调试，不参与世界回合会话。

## 测试

新增 `src/__tests__/turnRuntime.spec.ts`，使用真实 store、调度器、编排器和 useSaveGame，模型与动画为桩：

- 停点保留日期指令，恢复后日期只提交一次；guard 失效时保留队列并上抛错误；await 后 guard 阻止回执和停点写入；演出失败或中点已提交的情况都只推进一次日期；detach/restore 保留执行上下文。
- 暂停时不进行战斗、叙事或日期推进；恢复后，收税、日期推进和模型决策都只发生一次。暂停期间玩家指令可独立执行，世界剩余项不会被顺带执行。
- 换局后断点作废，旧指令不执行；带快照的存档和读档能恢复暂停的世界回合；玩家残留阶段（drain）暂停后存档和读档，能在收税前恢复。
- 不带快照的存档进入只结算恢复；篡改的快照会被拒绝，包括 system 权限、日期指令、不可能的阶段、错误锚点、日期不一致和非数组 remaining。
- 直接自动／外交存档会附带暂停快照，读档后剩余世界指令继续执行，不重复收税或重新请求决策。
- 外交收口叙事不会被误认为世界总结；守方在调味等待期间易主时不按旧前提结算；guard 失效时丢弃全部战果；调味失败后重试只打一轮战斗，且不重复收税。

已有测试的更新：`worldAiWait`、`aiFallback`、`worldBatchPreflight` 中的调度器桩补齐了新契约（status、queue、detach/restore、日期提交），外交桩补了 `recoverSession`。`worldBatchPreflight` 只断言 faction 权限的提交，因为引擎现在总会提交系统日期指令。`schedulerAiWait`、`schedulerRewards`、`supply` 的断言没有修改。

最终集成验证结果（Node 24.21.0 / pnpm 10.34.6）：

- `vue-tsc --noEmit` 通过。
- `oxlint` 检查本轮修改的 14 个前端 TypeScript 文件：0 警告，0 错误。
- 前端全量回归：57 个文件，631 项通过，4 项真实模型相关测试跳过；没有失败或未处理异常。参数为 `--maxWorkers=2 --testTimeout=15000`。
- 后端离线单元及 HTTP 集成测试：42 项通过。
- 根目录 `pnpm build`：前端 Vue 类型检查、Vite 生产构建和后端 Nest 构建均通过。Vite 主包超过 500 kB 的警告仍存在。
- 原复现文件 `map-war-architecture-reproduction.spec.ts` 中，“暂停丢日期”“内核忽略暂停”两项断言的是旧缺陷行为，修复后应失败；对应的反向不变量已写入 `turnRuntime.spec.ts`。

## 架构评价与建议

- **方向正确**：本地确定性公式是主干，AI 调味受到钳制，并有共享截止时间和迟到结果丢弃，这些设计都值得保留。这次修复的问题集中在“谁决定回合结束”：以前由一串 `await` 隐式决定，现在由显式阶段和断点决定。
- **建议 1**：把 `TurnProgress` 抽成不依赖 Vue 的 `TurnRuntime` 类，由 `GameSession` 持有，并注入 store、调度器和模型端口，以替代模块级单例。这样也方便做无界面批量对局。
- **建议 2**：store 提供显式的 `worldGeneration`（读档、initWorld 时递增），供 kernel、外交和调度器的 guard 统一使用，替代“锚点身份 + reloadToken + 势力”的组合判据。
- **建议 3**：战斗结算改为“计算 `EventBatch` → `applyEvents` 原子提交 → 演出”，把最多一次升级为恰好一次的事务。
- **存档统一化**：本次已覆盖自动存档的快照提供器，下一步应加入明确的规则版本、seed 版本和迁移策略，而不是长期依赖版本 1 的可选字段。
- **建议 5**：模型失败的势力目前只是“未行动”，可以利用已有的主动目标生成规则 AI 兜底指令，并标记为规则决策。
