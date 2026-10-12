# 新局史诗开场：正式接入说明

样片 `map-war-intro-demo` 已经用户批准，本文记录它接入正式游戏的方式。动画仍是 18 秒六幕：落墨、题年、展卷、群雄、本方、受命，有 paper / night 两套美术。DOM 时间轴用 Vue 写，地图部分复用 `LeafletMap` 里**唯一的** Pixi `Application`。

## 触发与身份

- 开场只由择势页（`OnboardingView.handleEnter`）的“开战”显式触发。顺序是：`ensureWorld()` → `setPlayer()`（仍然只写一条 `selectFaction` 事件）→ `requestNewGameIntro(faction, reloadToken)`。
- `composables/useNewGameIntro.ts` 是模块级的一次性 UI 意图。它不进 store、不进 eventLog、不进存档。地图侧用 `takeNewGameIntro()` 取走后立即清空。
- 地图侧**不 watch currentFaction 来启动开场**。读档、重放、GameOver 重开都不会产生意图，所以都不播放。`currentFaction`、`reloadToken`、`playerName` 和事件锚点的 watch 只负责**取消**开场，并丢弃还没消费的旧意图。
- 世界身份 token 由 `reloadToken | faction | playerName | 末条 selectFaction 事件对象的 id` 组成，事件对象 id 用 WeakMap 分配。假如 initWorld 之后在同一 tick 用相同阵营、相同姓名重新 setPlayer，事件对象也会是新的，旧开场因此不会把终态镜头写进新局。
- 开场时的用户名、势力、焦点城、邻接势力、群雄印和疆域，都在开场开始时从 store 实时读取（`buildIntroCast`）。用户名经 `displayPlayerName` 处理：trim、按码点截到 12 个字符、空名回退为“无名”。显示只用 Vue 文本插值，不用 `v-html`。
- 焦点城的选取顺序：候选表里第一个“存在、已注册、归本方”的城市 → 本方驻军最多的已注册城市 → 本方任一城市。四川（SCC）落在成都（重庆在开局时属于国民政府），中共（CCP）落在赣州。疆域取景只沿陆路连通；台湾只有海路连接，所以不进日本关东军（JPN）的取景。

## 慢地图 / 就绪 / 失败

- `LeafletMap.onMounted` 在第一个 await 之前调用 `ensureWorld()`，这个调用是幂等的，已经播种过就不再 initWorld。用户如果在地图初始化变慢时已经开战，用户名、势力和事件都不会被清掉。
- 地图就绪信号 `mapReadyState`（pending / ready / failed）需要以下条件全部满足：
  1. 世界底图已尝试加载；
  2. 第一个市级 `loadLayer` 成功；
  3. 城市 gb 已注册；
  4. `document.fonts.ready` 触发的二次 loadLayer 完成，或已过 4 秒。

  核心图层失败或 `app.init` 失败时，状态记为 failed，不再抛出未捕获异常。
- 导演 `IntroDirector` 走到地图闸门（完整版 5.6 秒、减少动态版 1.6 秒）时，如果地图还没就绪，就停下等待。等待超过 15 秒或收到失败，进入 error：这时停掉 RAF 和定时器，**释放输入锁**。错误面板仍挡在地图上方，但面板上的“重试”和“返回舆图”按钮、以及 Esc 键都能用。重试时调用 `retryLoad()`；它同步抛错或异步失败都会回到 error，不会挂起。
- `finish()` 只会执行一次。`onStatus`、`onFrame`、`onCue` 回调，以及端口的 `destroyLayer`、`setFinalCamera`、`worldToken`、释放函数，无论哪个抛错，`done` 都一定 resolve，锁也一定释放（有单测覆盖）。

## 清理

- **跳过**（Esc、跳过按钮、点击画面或 Enter / Space；后两者需开场 0.5 秒后）：outcome 为 `skipped`，按当前视口重新计算终态镜头。
- **卸载 / 切路由**：`EpicIntro.onBeforeUnmount` 调用 `cancel()`，不写终态镜头。随后 `LeafletMap.onUnmounted` 兜底：清理开场层和锁、恢复地名层可见性、cancel 补间、settle 等待者、清字体定时器、stop 在 await 之后创建的 watch，并按 `appReady` 只销毁一次 app。
- **读档 / 世界替换**：token 变化，执行 cancel，不写终态镜头。
- **resize**：跳到按新视口重新计算的终态（取舍见下文）。
- **后台标签页**：暂停计时。

`onMounted` 里 `app.init` 和之后的每个 await 都带 `mapDisposed` 检查。如果在 `app.init` 进行中卸载，由 onMounted 在 init 返回后销毁 app。

## 相机

旧版 `animateCameraTo` 在被新调用顶替时，旧 promise 永远不会 resolve。现在改用 `utils/cameraTween.ts`：自然结束、被顶替、`cancel()`、AbortSignal、减少动态、duration ≤ 0 这几种情况都会 resolve。函数签名保持 `(target, duration)`，新增一个可选的第三参数 `opts`，旧调用无需改动。`cameraController` 的 API 也没变。

开场镜头不用补间 promise。每帧从可 seek 的时间轴算出 shot，直接设置 `mapScale/mapX/mapY`，再调用 `applyCamera()`。减少动态版的镜头只有两档：闸门前停在 wide，之后直接跳到 final，中间不做补间。

## 渲染与性能

- 开场专用 Pixi 层有两个：`introWorldLayer`（跟随相机，位于 fx 之上、地名之下）和 `introScreenLayer`（屏幕空间，位于最上层）。两层都**不在** world/label/fx 容器里，所以 loadLayer 和战斗重置不会清掉它们。
- 本方填色、压暗（反向遮罩）、朱砂勾边、群雄印和城名，都只在 `buildLayer` 时建一次。每帧只改 alpha、visible、position、scale，不重建 Graphics。
- 城市外接框只把经纬度极值换算成两个角，并按视口尺寸缓存。
- 现有地名层 `labelContainer` 在持有开场锁期间隐藏。可见性只通过 `syncLabelVisibility()` 写入，取 `labelsVisible && introLockCount === 0`，不修改用户偏好。释放锁时（完成、skip、cancel、error、卸载）按偏好恢复；loadLayer 和字体重绘也走这个函数，不会把地名重新显示到开场画面上。error 状态下锁已释放，地名会在错误面板下方恢复显示。
- 已知代价：每帧 `applyCamera()` 会调用现有的 `updateLabels()` 和 `syncBattleCards()`。这样做和原镜头演出一致；开局时没有战斗卡，代价主要来自标签。验收使用 Chromium 软件 WebGL，不代表实体设备帧率。

## 音频、主题与输入

- 默认静音。用户点击“开启音效”后，才在这次手势里创建或恢复 AudioContext。
- 主题跟随 `prefers-color-scheme`：暗色用 night，否则用 paper。动画时长看 `prefers-reduced-motion`：开启时 3.6 秒，否则 18 秒。
- `body.intro-active` 期间，`.map-ui` 和战斗卡立即隐藏且不可点。地图的滚轮、拖拽、点击被 `introLockCount` 拦截；`onKeyDown` 把键盘交给开场层处理，所以 Esc 不会走 `cameraController.cancel()`，A / M 快捷键也不会触发。
- 正式游戏**没有重播入口**。样片的重播只保留在独立样片里。

## 与样片的差异和取舍

1. 新增 exit 淡出：完整版 17.5–18 秒，减少动态版 3.35–3.6 秒。这样开场层不会在最后一帧突然消失。
2. resize 时跳到终态，不重建开场层，也不续播。这样最简单、最稳，但移动端地址栏伸缩之类的 resize 也会提前结束演出。
3. 字体沿用正式游戏已有的汇文明朝体全 CJK 分片，没有新增字体。纸纹直接复用样片的 `paper.webp`（约 100KB）。
4. night 主题只跟随系统设置，正式版没有手动切换入口。
5. 世界播种从 “onMounted 里无条件 initWorld” 改成 “ensureWorld 幂等”。这是对现有行为唯一的语义改动：城市为空时仍然播种，行为和以前相同。

## QA 钩子（仅 DEV）

`window.render_game_to_text()` 新增以下字段：

- `intro`：active 快照、pendingRequest、playedCount、last；
- `mapReady`；
- `locks`：cameraLocked、introLock、tweenActive；
- `store`：faction、playerName、eventCount、lastEventType、reloadToken、isReplaying、cityCount。

关键 DOM 节点的 data-testid：

- 择势页：`onboarding-name`、`onboarding-faction-<OWNER>`、`onboarding-enter`；
- 开场层：`epic-intro`、`intro-roster`、`intro-card`、`intro-faction-label`、`intro-neighbors`、`intro-lockup`、`intro-stamp`、`intro-decree`、`intro-player-name`、`intro-waiting`、`intro-error`、`intro-retry`、`intro-dismiss`、`intro-mute`、`intro-skip`。

## 文件

新增：

- `apps/web/src/components/EpicIntro.vue`
- `apps/web/src/composables/useNewGameIntro.ts`
- `apps/web/src/utils/cameraTween.ts`
- `apps/web/src/utils/intro/introTimeline.ts`
- `apps/web/src/utils/intro/introPlan.ts`
- `apps/web/src/utils/intro/introDirector.ts`
- `apps/web/src/utils/intro/introAudio.ts`
- `apps/web/src/utils/intro/introInk.ts`
- `apps/web/src/assets/intro/paper.webp`
- `apps/web/src/__tests__/cameraTween.spec.ts`
- `apps/web/src/__tests__/introPlan.spec.ts`
- `apps/web/src/__tests__/introDirector.spec.ts`
- `apps/web/src/__tests__/newGameIntro.spec.ts`
- `apps/web/src/__tests__/introIntegrationContract.spec.ts`
- `docs/epic-intro-integration.md`

修改：

- `apps/web/src/components/LeafletMap.vue`
- `apps/web/src/views/OnboardingView.vue`
- `apps/web/src/stores/game.ts`（只新增 `ensureWorld`）
- `apps/web/src/App.vue`（只新增 `body.intro-active` CSS）

## 未自动测试的范围

需要浏览器 QA 的部分：

- 真实 WebGL 下的反向遮罩、勾边、印章和城名的视觉效果；
- 18 秒画面的节奏、paper / night 两套主题、移动端布局；
- 实体设备帧率（软件 WebGL 验收环境中，原地图本身帧率较低；不能据此推断用户设备表现）；
- 真实 AudioContext 的出声；
- 真实网络失败和超时下错误面板的布局；
- 真实 resize；
- 真实切路由或卸载时的 Pixi 销毁时序（LeafletMap 依赖 WebGL 和 4MB geojson，jsdom 挂不起来，只做了源码契约测试）。

## 最终浏览器验收与补充修复

- **动态身份**：实际开局检查川军“云帆”、关东军“`<b>主公</b>`”、滇系十二字姓名和中共“明月”。受命文字、势力标签、焦点城市均来自所选身份；HTML 字样作为纯文本，没有生成 `b` 节点。关东军镜头焦点为大连，排除不连通飞地。
- **事件边界**：完整播放或跳过之后，仍然只有一条 `selectFaction` 事件，375 座城市，输入锁归零，RAF 和等待定时器已清理。实际完整开场验收未请求 AI API。
- **读档**：通过真实存档选择器载入合法 v1 川军存档样例，恢复“测试将军”，事件数为 1，`playedCount` 为 0，没有新开场意图。
- **移动与偏好**：390 × 844 视口下，滇系、night 主题、减少动态版正常完成；时间轴终点为 3.6 秒，身份不丢失，没有页面脚本错误。没有在实体手机或扬声器上验证。
- **故障恢复**：拦截市级 GeoJSON 为 HTTP 503 后，实际错误面板出现，锁为 0；撤去拦截后单次重试成功，等待期间 Esc 跳过，最终 `mapReady:ready`、`outcome:skipped`，没有额外世界事件或脚本错误。
- **缓存修复**：验收发现原 `loadLayer` 会缓存 HTTP 错误的 JSON，字体重绘可能留下坏缓存，使首次重试仍失败。现在仅在 HTTP 成功且响应为带 `features` 数组的 FeatureCollection 时缓存，并在开场重试前清掉核心图层缓存。源码契约测试补了校验与缓存顺序检查，真实浏览器已复验单次恢复。
- **后台计时**：可见性切换显式重置时钟基准，并在隐藏时清声音节点；即使浏览器完全停止后台 RAF，切回时也不会把后台停留计入动画进度。单测模拟了 60 秒没有任何 RAF 回调的情况。
- **预览边界**：在线集成预览使用单独生成的部署包，适配相对资源路径、路由基址与内存存档，并阻止请求 AI 后台；这些适配不在正式仓库内。正式游戏的持久化存档、路由配置和 AI 端点保持不变。

最终全量回归使用 `vitest run --pool=threads --maxWorkers=1`：60 个测试文件通过、4 个跳过，716 个用例通过、5 个跳过。并行执行浏览器／构建时曾有两个既有 AI 上下文用例超过默认 5 秒限制；关闭软件渲染浏览器、限制一个测试 worker 后全量通过，没有改变断言或延长测试超时。

另外执行 `vue-tsc --noEmit`、`vite build`，并对 17 个改动源码／测试文件执行不带 `--fix` 的 oxlint。真实模型测试和需显式输出参数的公式审计测试不在本次离线验收中执行；构建保留原有的大包体积提醒，不作帧率或加载耗时承诺。
