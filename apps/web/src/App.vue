<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { useSaveGame } from '@/composables/useSaveGame'
import GameModal from '@/components/ui/GameModal.vue'
import OnboardingView from '@/views/OnboardingView.vue'
import SaveSelectorModal from '@/components/SaveSelectorModal.vue'
import PlayerStatusPanel from '@/components/PlayerStatusPanel.vue'
import ToastStack from '@/components/ui/ToastStack.vue'

const gameStore = useGameStore()
const { loadGame } = useSaveGame()

// 进入页面时是否已有存档（listSaves 读 localStorage，非响应式；用于开局路由 + 返回链接）
const hasSaves = computed(() => Object.keys(gameStore.listSaves()).length > 0)
// 用户在选择器点了"另起新局"，把舞台让给择势面板
const dismissed = ref(false)

const inGame = computed(() => gameStore.currentFaction !== null)

// 三态互斥；replay 期间都不弹，避免读档瞬间多个 body Teleport 挂载竞态
const showSelector = computed(
  () => !gameStore.isReplaying && !inGame.value && hasSaves.value && !dismissed.value,
)
const showOnboarding = computed(
  () => !gameStore.isReplaying && !inGame.value && (!hasSaves.value || dismissed.value),
)

function onLoad(slot: string): void {
  // 读档成功后 currentFaction 恢复为真实值 → 两弹窗自动隐藏，进入游戏；
  // 失败（存档损坏等）则保持选择器，用户可另选。
  loadGame(slot)
}

function onNewGame(): void {
  dismissed.value = true
}

function onBackToSelector(): void {
  dismissed.value = false
}
</script>

<template>
  <RouterView />
  <PlayerStatusPanel v-if="inGame" class="map-ui" />

  <SaveSelectorModal :visible="showSelector" @load="onLoad" @new-game="onNewGame" />

  <GameModal
    :visible="showOnboarding"
    title="择势"
    width="760px"
    :z-index="10000"
    :closable="false"
    variant="parchment"
    @close="() => {}"
  >
    <OnboardingView :show-back="hasSaves && dismissed" @back="onBackToSelector" />
  </GameModal>

  <!-- 轻量提示层：Teleport 到 body，独立渲染，不受地图演出/模态遮挡影响 -->
  <ToastStack />
</template>

<style>
:root {
  /* 羊皮纸色阶（由浅到深） */
  --paper: #e2d4b6;
  --paper-panel: #e9dcc4;
  --paper-input: #e6d8bd;
  --paper-deep: #ddccab;
  --paper-darker: #dccdb0;
  --paper-dark: #d6c3a0;
  --paper-darkest: #cbb389;
  --paper-head: #e0d1b1;
  --paper-head2: #d4c39c;
  --paper-hi: #f1e9d3;
  --paper-hi2: #e3d6bb;
  --paper-faint: #e8dcc0;

  /* 墨色（文字，由深到浅） */
  --ink: #3b2a18;
  --ink-strong: #2c1a0a;
  --ink-darkest: #2c1f0f;
  --ink-panel: #5a3d1f;
  --ink-soft: #7a5c38;
  --ink-mid: #4a3018;
  --ink-deep: #5a4326;
  --ink-mute: #6b4e2e;
  --ink-muted: #9a8560;
  --ink-faint: #7a6a50;

  /* 朱砂红 */
  --cinnabar: #b04a3a;
  --cinnabar-bright: #c24a3a;
  --cinnabar-deep: #a03020;
  --cinnabar-deep2: #b23828;
  --cinnabar-edge: #8a3a2a;
  --cinnabar-line: #d45842;
  --cinnabar-ink: #7a2a1a;
  --cinnabar-ring: rgba(176, 74, 58, 0.33);

  /* 危险红 */
  --danger-bg: #d3a39a;
  --danger-bg2: #c28f85;
  --danger-ink: #8a2828;
  --danger-text: #ff8888;

  /* 褐 / 棕（边框、分隔、底色） */
  --brown: #8a6d4b;
  --brown-deep: #7a5c30;
  --brown-line: #b8a07a;
  --brown-line-faint: rgba(138, 109, 75, 0.22);
  --brown-warm: #a08050;
  --brown-soft: #b0a080;
  --brown-pale: #c9bca0;
  --brown-paler: #d4c4a0;

  /* 链接（深色调试面板内） */
  --link: #7eb8ff;

  /* 字体 */
  --font-kai: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  --font-xing: 'STXingkai', 'Xingkai SC', 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  --font-song: Georgia, 'Songti SC', 'SimSun', serif;

  /* 圆角量表（§16-7 Craft）：紧致阶梯，全站吸附到最近一档，避免随手填数。
     方角四档 + 圆形一档；50% 圆形 toggle 走 --radius-pill，不进方角阶梯。 */
  --radius-xs: 2px;   /* 微件：输入框、图例色块、细芯片 */
  --radius-sm: 4px;   /* 小件：按钮、菜单、Toast、小列表 */
  --radius-md: 6px;   /* 中件：卡片、面板、区块 */
  --radius-lg: 12px;  /* 大容器：Modal、Dock、主框架 */
  --radius-pill: 999px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 云雾演出期间：淡出所有顶层 UI，使 PixiJS 云雾视觉覆盖整屏 */
.map-ui {
  transition: opacity 0.45s ease;
}
body.cloud-active .map-ui {
  opacity: 0;
  pointer-events: none;
}

/* ── 自定义滚动条：羊皮纸凹槽 + 朱砂铜制滑块 ── */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
/* 轨道：嵌进羊皮纸的一道浅凹槽 */
::-webkit-scrollbar-track {
  background: rgba(138, 109, 75, 0.10);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 0 4px rgba(60, 40, 15, 0.14);
}
/* 滑块：铜褐渐变 + 浅顶高光，像刻出的铜件 */
::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #a8885a 0%, #6b4e2e 100%);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(44, 26, 10, 0.35);
  box-shadow:
    inset 0 1px 1px rgba(255, 240, 210, 0.30),
    0 1px 2px rgba(60, 40, 15, 0.20);
}
/* 悬停：转朱砂红，呼应印章/封蜡主题 */
::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, var(--cinnabar-bright) 0%, var(--cinnabar-deep) 100%);
  border-color: var(--cinnabar-edge);
}
::-webkit-scrollbar-thumb:active {
  background: linear-gradient(180deg, var(--cinnabar-deep2) 0%, var(--cinnabar-edge) 100%);
}
::-webkit-scrollbar-corner {
  background: transparent;
}

/* Firefox 兼容 */
* {
  scrollbar-width: thin;
  scrollbar-color: #6b4e2e rgba(138, 109, 75, 0.10);
}

/* ── 无障碍：前庭敏感用户降级（Apple §14）──
   保留短促淡入淡出，关闭一切位移 / 缩放 / 模糊等会引发眩晕的运动。
   各组件内部的 Transition 也各自带 reduced-motion 覆盖，这里兜底所有按钮按压。 */
@media (prefers-reduced-motion: reduce) {
  .game-btn:active,
  .game-btn.parchment:active,
  .act-btn:active,
  .new-btn:active,
  .psp-toggle:active,
  .city-list-toggle:active,
  .psp-rail:active,
  .layer-switcher button:active,
  .faction-card:active,
  .enter-btn:active,
  .context-menu-item:active,
  .psp-body li:active {
    transform: none !important;
    scale: 1 !important;
  }
}

/* ── 无障碍：高对比需求（Apple §15 可达性）──
   用户在系统开启「更高对比度」后，把低对比的次要文字令牌加深到可读阈值。
   原 --ink-muted/--ink-soft/--ink-faint 在羊皮纸底上对比偏低（约 2.5:1），
   加深后约 5:1，避免把文字信息推到可读线以下。正常用户不受任何影响。 */
@media (prefers-contrast: more) {
  :root {
    --ink-soft: #5a4326;
    --ink-muted: #6b4e2e;
    --ink-faint: #5a4326;
  }
}
</style>

