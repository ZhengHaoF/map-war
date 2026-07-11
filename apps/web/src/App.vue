<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import GameModal from '@/components/ui/GameModal.vue'
import OnboardingView from '@/views/OnboardingView.vue'
import PlayerStatusPanel from '@/components/PlayerStatusPanel.vue'

const gameStore = useGameStore()
const showOnboarding = computed(() => gameStore.currentFaction === null)
</script>

<template>
  <RouterView />
  <PlayerStatusPanel v-if="!showOnboarding" />
  <GameModal
    :visible="showOnboarding"
    title="择势"
    width="760px"
    :z-index="10000"
    :closable="false"
    variant="parchment"
    @close="() => {}"
  >
    <OnboardingView />
  </GameModal>
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
</style>
