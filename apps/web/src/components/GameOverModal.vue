<template>
  <GameModal
    :visible="visible"
    :title="isVictory ? '天下一统' : '势力覆灭'"
    variant="parchment"
    :closable="false"
    width="420px"
    :z-index="20000"
  >
    <div class="gom-body">
      <div class="gom-icon" :class="{ 'gom-icon--victory': isVictory }">
        {{ isVictory ? '👑' : '💀' }}
      </div>

      <p class="gom-message">
        {{ isVictory
          ? '恭喜主公，扫平群雄，一统江山！'
          : '大势已去，来日再战……' }}
      </p>

      <p class="gom-date">
        终结于 {{ store.gameOver?.endedAt ?? '?' }}
      </p>

      <div class="gom-stats">
        <div class="gom-stat-row">
          <span class="gom-stat-label">统治城池</span>
          <span class="gom-stat-value">{{ playerCityCount }}</span>
        </div>
        <div class="gom-stat-row">
          <span class="gom-stat-label">总兵力</span>
          <span class="gom-stat-value">{{ playerTroops }}k</span>
        </div>
        <div class="gom-stat-row">
          <span class="gom-stat-label">在位回合</span>
          <span class="gom-stat-value">{{ store.turnCount }}</span>
        </div>
      </div>

      <div class="gom-footer">
        <GameButton parchment @click="onRestart">
          <component :is="ICONS.refresh" :size="14" />重新开始
        </GameButton>
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useGameStore } from '@/stores/game'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
import IconRefresh from '~icons/tabler/refresh'

const ICONS: Record<string, Component> = {
  refresh: IconRefresh,
}

const store = useGameStore()

const visible = computed(() => store.gameOver?.ended ?? false)
const isVictory = computed(() => store.gameOver?.reason === 'allEnemiesDefeated')

const playerCityCount = computed(() => {
  const f = store.currentFaction
  if (!f) return 0
  return Object.values(store.cities).filter(c => c.owner === f).length
})

const playerTroops = computed(() => {
  const f = store.currentFaction
  if (!f) return 0
  return Object.values(store.cities)
    .filter(c => c.owner === f)
    .reduce((s, c) => s + c.troops + c.fieldForce, 0)
})

function onRestart(): void {
  store.resetGameOver()
  store.initWorld()
}
</script>

<style scoped>
.gom-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--ink);
  font-size: 14px;
  padding: 8px 0 0;
}

.gom-icon {
  font-size: 48px;
  margin-bottom: 12px;
  filter: grayscale(0.3);
}

.gom-icon--victory {
  filter: none;
  animation: gom-pulse 1.5s ease-in-out infinite;
}

@keyframes gom-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.gom-message {
  font-family: var(--font-song);
  font-size: 18px;
  font-weight: 600;
  color: var(--ink-panel);
  letter-spacing: 2px;
  text-align: center;
  margin-bottom: 8px;
}

.gom-date {
  font-size: 13px;
  color: var(--ink);
  opacity: 0.5;
  margin-bottom: 16px;
}

.gom-stats {
  width: 100%;
  border-top: 1px solid rgba(90, 70, 40, 0.2);
  border-bottom: 1px solid rgba(90, 70, 40, 0.2);
  padding: 12px 0;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gom-stat-row {
  display: flex;
  justify-content: space-between;
  padding: 0 20px;
  font-size: 14px;
}

.gom-stat-label {
  color: var(--ink);
  opacity: 0.6;
}

.gom-stat-value {
  font-weight: 600;
  color: var(--ink-panel);
}

.gom-footer {
  display: flex;
  justify-content: center;
  width: 100%;
  padding-bottom: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .gom-icon--victory {
    animation: none;
  }
}
</style>
