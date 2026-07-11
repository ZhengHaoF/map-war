<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import GameModal from '@/components/ui/GameModal.vue'
import OnboardingView from '@/views/OnboardingView.vue'

const gameStore = useGameStore()
const showOnboarding = computed(() => gameStore.currentFaction === null)
</script>

<template>
  <RouterView />
  <GameModal
    :visible="showOnboarding"
    title="择势"
    width="760px"
    :z-index="10000"
    :closable="false"
    @close="() => {}"
  >
    <OnboardingView />
  </GameModal>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
