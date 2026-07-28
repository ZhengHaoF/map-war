# 游戏 UI 设计评估（对照 Apple 设计规范）

> 范围：**纯 UI 设计**（材料/深度、排版、配色与空间一致性、层级分组、反馈、可达性），**不含动效**（动效已在 `docs/动效设计评估.md` 单独评估）。
> 方法：静态代码审阅（`App.vue` 全局令牌 + 全部浮层/弹窗/Toast/HUD/AI 操作台/择势/读档/地图浮层）。
> 说明：本项目刻意采用「羊皮纸 + 水墨 + 朱砂」中国风（见项目记忆），与 Apple 的「浅色半透明玻璃」体系本就不同源。因此**凡属主题取舍、非可用性缺陷的，单独标注为「风格取舍」**，不与硬伤混计。

---

## 总评：7 / 10 — 令牌与一致性骨架极好，两处材质/配色断裂拉低完成度

设计令牌系统、配色语义、图标体系、层级分组、反馈闭环都做得相当专业；扣分项集中在**「全站羊皮纸」语言里混入了两处异质感元素**，以及少量 Apple 排版/可达性细则未覆盖。

---

## 一、达标项（保持，不要动）

### 1. 令牌系统 & 配色语义（§12 / §16-5 一致性）
`App.vue:67-127` 定义了完整的 `--paper / --ink / --cinnabar / --brown` 四级色阶，**单一事实来源**，全站复用。朱砂红统一承担「主操作 / 选中 / 危险 / 覆灭」语义，墨色承担文字层级，棕色承担边框分隔——色彩角色清晰、可预测。这是 Apple「Familiarity/一致性」要求的优秀实现。

### 2. 图标体系
全站统一 Tabler 图标，静态导入 + `<component :is>`，尺寸/描边一致（`PlayerStatusPanel`、`OnboardingView`、`GameDateDisplay` 等）。无混用多种图标集，无「有图无字 / 有字无图」错位。✓

### 3. 层级与分组（§16 分组与映射）
- HUD（`PlayerStatusPanel.vue`）：每块 `section` 用 `h3 + 虚线分隔 + 内缩` 清晰分组（领土总览 / 战斗 / 占位），城市清单就近展开在「领土总览」下——控制靠近受影响内容。✓
- 择势（`OnboardingView.vue:152-173`）：右侧名录选势力 → 左侧详情面板即时联动，映射直观。✓
- 读档（`SaveSelectorModal.vue`）：卡片主信息 + 右侧操作组，归属清晰。✓

### 4. 反馈闭环（§1 / §16 四类反馈）
- 按压反馈已全站铺开（上一轮落地）：`GameButton / faction-card / enter-btn / psp-toggle / layer-switcher button` 均有 `:active` 即时缩放。
- Toast 七色调（`GameToast.vue:83-96`）按状态/完成/警告/错误分色，左色条 + 图标着色，反馈有分类。✓
- 禁用态齐备（`enter-btn:disabled`、`GameButton :disabled`）。✓

### 5. 深度（§12 材料化）
弹窗 `GameModal` 用 `rgba(0,0,0,.5)` 遮罩把背景推后（dim-to-focus），叠加 `scale + blur` 物质化入场（上一轮落地）；HUD/日期条/图层器统一「羊皮纸底 + 棕边 + inset ring + 外阴影」配方，厚度一致。✓

---

## 二、🔴 P0 — 一致性硬伤（建议改）

### 1. AI 操作台按钮是「深色玻璃」，与全站羊皮纸语言断裂
`PlayerAiPanel.vue:28-34` 用的 `<GameButton>` 是**默认深色玻璃变体**（`GameButton.vue:29` `background: rgba(0,0,0,0.6)` + `backdrop-filter: blur(4px)` + 白字），而它所在的 `ai-dock` 本体是羊皮纸（`PlayerAiPanel.vue:163` `var(--paper-panel)`）。
→ 全站其它所有交互元素（图层器、HUD、Toast、上下文菜单、择势卡、读档卡）都是羊皮纸，唯独 AI 操作台的「发送/撤销」是深色玻璃药丸。这违反 Apple §5/§16-5「看起来相同的东西行为/质感应相同」，用户会以为这是另一个系统的控件。
**证据**：`PlayerAiPanel.vue:28` 未传 `parchment`；对比 `LeafletMap.vue:5-31` 图层器按钮（同样 `GameButton` 但被 `.layer-switcher button` 覆盖成羊皮纸）。
**修法**：给这两个按钮加 `parchment`，或在 `PlayerAiPanel` 作用域里把 `.ai-dock .game-btn` 重写成羊皮纸（与 `.layer-switcher button` 同一配方）。

### 2. 孤儿蓝色 `.game-btn.active` 脱离朱砂体系
`GameButton.vue:59-62` 定义 `.game-btn.active { background: rgba(59,130,246,.8); border-color: #3b82f6 }`（蓝色）。但全站「激活/选中」语义一律用朱砂（图层器 active、势力卡 selected、HUD 选中都是 `--cinnabar`）。
→ 任何**裸用** `GameButton` 且置 `:active` 的场景都会突然闪出系统蓝，破坏配色一致性（§5）。目前裸 `GameButton` 多在 AI 操作台且未传 `active`，故暂未暴露；但它是颗雷。
**修法**：删除该蓝色规则，或改为「继承 parchment.active 的朱砂态」。

---

## 三、🟠 P1 — 规范细则缺口

### 3. 字距未随字号分级（§15，风格取舍为主）
多处用**固定正值** letter-spacing 且不分大小：`title-year 28px/6px`、`sel-title 24px/6px`、`faction-name 17px/2px`、`section-label 12px/4px`、`onboard-sub 13px/5px`。Apple §15 要求大字用**负**字距、小字略正、正文近 0。
→ 但对**中文楷体**而言，「疏排」（大字也留间距）是古典排版的自觉审美，属风格取舍，**非硬伤**；唯一可挑的 `28px` 标题配 `6px` 过松，已于 2026-07-18 夜收紧到 `2px`（`OnboardingView.title-year`、`SaveSelectorModal.sel-title` 同步，见第九节）。低优先项已闭环。

### 4. 未支持 Dynamic Type / rem 缩放（§15，可达性）
全站尺寸几乎全是固定 `px`（`stat-num 20px`、`faction-name 17px`、`date-main 20px`…），无 `rem/em`、无 `clamp()`。用户放大系统字体时布局不随之放大（§15 明确要求 scale layout with text）。
→ 游戏类可接受，但从 Apple 可达性口径看是缺口。中等优先，若要冲「无障碍标杆」再处理。

### 5. 圆角无统一量表（§16-7 Craft）— ✅ 已修复
各组件圆角随意：`GameModal.parchment 2px`、`PlayerStatusPanel 8px`、`GameButton 6px`、`layer-switcher button 3px`、`ai-dock 12px`。Apple 用紧致、成体系的半径阶梯。
→ 不影响可用性，但削弱「刻意而非随意」的 craft 感。低-中优先：抽一个 `--radius-sm/md/lg` 量表统一即可。
**【已修复 2026-07-18 夜】**：`App.vue:root` 定义 `--radius-xs(2)/sm(4)/md(6)/lg(12)/pill(999)` 五档，全站 13 文件字面量（1/2/3/4/5/6/8/12px）吸附到最近档，`vue-tsc` + `vite build` 通过；圆形 `.psp-toggle` 的 `50%` 语义独立，保留字面量（亦可改用 `--radius-pill`）。详见第八节。

### 6. `prefers-reduced-transparency` / `prefers-contrast` 未处理（§14）
上一轮已全站铺 `prefers-reduced-motion`，但 §14 要求的三档信号里另两档（减透明、增对比）缺失。
→ 由于本 UI 多为**不透明羊皮纸**（非半透明玻璃），减透明需求弱；增对比在朱砂/浅墨低对比文字处可能有益（如 `--ink-muted` 小字）。已于 2026-07-18 夜补 `@media (prefers-contrast: more)`（`App.vue`），把 `--ink-soft/--ink-muted/--ink-faint` 加深到可读阈值（约 5:1），全站约 30 处低对比小字自动受益。低优先项已闭环。

---

## 四、🟡 P2 — 风格取舍（非缺陷，供决策）

### 7. 装饰密度偏高（§16-6 Simplicity）
卷轴边线（`scroll-edges`）、四角回纹（`corner-ornament`）、印章（`panel-seal`/`empty-seal`）、虚线分隔、铜制滚动条……装饰元素极丰富。对「古典战争游戏」是**恰当的 delight（§16-8）**，但与 Apple 的「克制」哲学相悖——属于主题压倒规范的典型场景，保留即可，仅提示：若后续要做「现代/极简」分支再减负。

### 8. 死样式：默认深色玻璃 Modal 未被使用
`GameModal.vue:137` 默认 `variant='dark'` 是 `rgba(20,20,40,.97)` 深蓝玻璃（含 `blur(16px)`，反而是全站最「Apple 材料」的一处），但**所有调用都传 `variant='parchment'`**，该深色变体实际是死代码。可删，或将来做「夜间/作战简报」主题时启用。

---

## 五、规范条款对照表

| Apple 条款 | 状态 | 说明 / 证据 |
|---|---|---|
| §1 响应（按下即反馈） | ✅ | 全站 `:active` 即时缩放（上一轮） |
| §5 熟悉性 / 一致性 | ✅ | P0-1/P0-2 已修复（见第七节） |
| §7 空间一致性 | ✅ | 弹窗/菜单进出门路径一致（上一轮） |
| §12 材料与深度 | ⚠️ | 羊皮纸不透明（主题取舍）；死样式深色玻璃 Modal 未用 |
| §14 可达性（动/透明/对比） | ✅ | 减动已做（上一轮）；增对比已补 `@media (prefers-contrast: more)`（2026-07-18 夜） |
| §15 排版（字距/行高/动态字号） | 🟠 | 大字 `6px→2px` 已收紧（2026-07-18 夜）；无 Dynamic Type；行高合理 |
| §16-1 目的 / §16-6 简洁 | 🟡 | 装饰密度高（主题 delight） |
| §16-3 责任 / §16-4 熟悉 | ✅ | 免责声明、确认删除二次态到位 |
| §16-5 灵活/一致 | ✅ | 令牌系统+图标+分组优秀 |
| §16-7 Craft | ✅ | 已抽取 `--radius-xs/sm/md/lg/pill` 量表，全站字面量吸附到最近档（2026-07-18 夜） |

---

## 六、结论与建议

- **必改（P0）**：把 AI 操作台的 `GameButton` 改成羊皮纸变体；删除/重染孤儿蓝色 `.game-btn.active`。两处都是「同一系统里混入异质感」，改完整体 cohesive 度会上一个台阶。
- **可选（P1）全部闭环**：圆角量表、高对比 `@media (prefers-contrast: more)`、大标题字距 `6px→2px` 均已于 2026-07-18 夜落地（见第七/八/九节）。仅剩「无 Dynamic Type / rem 缩放」（§15，游戏类可接受，未处理）。
- **保持**：令牌系统、图标、分组、反馈、深度——已经是专业水准，别动。
- 本报告最初为纯审阅（未改代码）；后续 P0 / P1（圆角、高对比、字距）已全部落地，见第七/八/九节。

---

## 七、修复落地（2026-07-18）

两处 P0 已按结论直接落地，`vue-tsc --noEmit` 零错误、`vite build` 通过（833 模块）。

| 项 | 文件:行 | 改动 | 对照 |
|---|---|---|---|
| P0-1 AI 操作台按钮羊皮纸化 | `PlayerAiPanel.vue:28,31` | 两个 `<GameButton>` 加 `parchment` prop（发送 / 撤销）。现与所在 `ai-dock` 羊皮纸底同语言，字体转楷体、按压走 `.game-btn.parchment:active` 纸面下沉反馈 | §5/§16-5 |
| P0-2 孤儿蓝重染 | `GameButton.vue:59-62` | 删除 `rgba(59,130,246)` 蓝，改为 `rgba(178,58,46,.85)` 朱砂强调（白字）。所有 `:active` 激活态统一讲朱砂语义；parchment 变体仍走更深的纸面朱砂态，互不冲突 | §5 |

**说明**：原报告「删除」分支因 `AiDebugPanel.vue:38` 的「发送」按钮裸用 `:active="loading"`（深色玻璃调试面板）而不可直接删除——故走「重染」分支，将其蓝改为朱砂，既消除异质感又保留该调试按钮的激活反馈。`AiDebugPanel` 本身仍是深色玻璃（开发者面板，未纳入本次 P0 范围）。

**当前 §5 一致性**：✅ 全站无蓝色激活态、无羊皮纸中混入的深色玻璃按钮（AI 操作台已统一）。

---

## 八、圆角量表落地（2026-07-18 夜）

P1-5 已落地，`vue-tsc --noEmit` 零错误、`vite build` 通过（833 模块）。

**量表（`App.vue:root`）**：`--radius-xs: 2px`｜`--radius-sm: 4px`｜`--radius-md: 6px`｜`--radius-lg: 12px`｜`--radius-pill: 999px`。

**吸附映射**：`1,2 → xs`｜`3,4 → sm`｜`5,6 → md`｜`8,12 → lg`；圆形 `50%`（`.psp-toggle`）语义独立，保留字面量（亦可用 `--radius-pill`）。

| 原值（散布） | 吸附档 | 代表文件 |
|---|---|---|
| `1px` / `2px` | `--radius-xs` | OnboardingView（label-mark / input-frame / panel-seal / faction-card / card-seal）、SaveSelectorModal（save-card / card-badge / act-btn）、LegendPanel（legend-color）、GameModal.parchment |
| `3px` / `4px` | `--radius-sm` | EventLogPanel、LeafletMap（layer-switcher / battle-item）、GameToast、PlayerStatusPanel（faction-swatch / badge / rail-color / scrollbar）、PlayerAiPanel（dock-collapse / dock-queue / scrollbar）、SaveSelectorModal（new-btn / empty-seal）、GameContextMenu、LegendPanel、OnboardingView（enter-btn / empty-seal） |
| `5px` / `6px` | `--radius-md` | PlayerStatusPanel（stat / city-list-toggle / battle-list / pending-note）、PlayerAiPanel（dock-error / dock-textarea / log-msg）、AiDebugPanel（全系列卡片/文本区）、GameButton |
| `8px` / `12px` | `--radius-lg` | App.vue（主框架）、PlayerStatusPanel（psp）、PlayerAiPanel（ai-dock）、GameModal.dark |

**验证**：grep 全站已无残留的 `border-radius: <数字>px` 字面量（除圆形 `50%`），所有方角统一走 token。视觉位移极小（主要为 8px→12px 的大容器档），但全站圆角从此讲同一种语言，§16-7 Craft 一致性达标。

---

## 九、高对比 & 字距落地（2026-07-18 夜）

P1-3（字距过松）、P1-6（prefers-contrast）已落地，`vue-tsc --noEmit` 零错误、`vite build` 通过（833 模块）。

| 项 | 文件:行 | 改动 | 对照 |
|---|---|---|---|
| P1-3 大标题字距收紧 | `OnboardingView.vue:403`、`SaveSelectorModal.vue:205` | `.title-year`(28px) 与 `.sel-title`(24px) 的 `letter-spacing: 6px → 2px`，保留楷体疏排韵味但不再过松 | §15 |
| P1-6 高对比可达性 | `App.vue`（新增 `@media (prefers-contrast: more)`，置于 reduced-motion 块之后） | 用户系统开启「更高对比度」时，把 `--ink-soft #7a5c38 → #5a4326`、`--ink-muted #9a8560 → #6b4e2e`、`--ink-faint #7a6a50 → #5a4326` 加深到约 5:1；全站约 30 处低对比小字（HUD/读档/AI 台/调试面板等）自动受益，正常用户零影响 | §14 |

**验证**：类型检查零错误、生产构建通过。建议在系统开启「更高对比度」后打开游戏，核对 HUD 小字、读档次要文字、AI 操作台说明文字的可读性。

**当前 §14 / §15 状态**：✅ §14 三档信号（减动/减透明弱需求/增对比）已齐；§15 字距过松点已修复，仅剩 Dynamic Type 一项（游戏类可接受，未处理）。
