<template>
  <GameModal
    :visible="visible"
    :title="isVictory ? '天下一统' : '势力覆灭'"
    variant="parchment"
    :closable="false"
    width="520px"
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

      <!-- 终局回顾：城池趋势 + 功业印章 -->
      <div class="gom-review">
        <div class="gom-review-title">本局回顾</div>
        <div v-if="cityTrend.length > 1" class="gom-review-chart">
          <TrendChart :points="cityTrend" color="var(--cinnabar)" unit="城" metric="统治城池" />
        </div>
        <div v-else class="gom-review-empty">征程过短，暂无趋势可绘。</div>
        <div v-if="unlockedSeals.length" class="gom-review-seals">
          <span
            v-for="m in unlockedSeals"
            :key="m.id"
            class="gom-seal gom-seal--unlocked"
            :title="`${m.title} · ${m.flavor}`"
          >{{ m.sealChar }}</span>
        </div>
        <div v-else class="gom-review-empty">尚未立下功业。</div>
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
import TrendChart from '@/components/ui/TrendChart.vue'
import { MILESTONES } from '@/data/milestones'
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

/** 城池数趋势（回合采样，终端回首可回顾全局沉浮） */
const cityTrend = computed(() =>
  store.turnSnapshots.map((s) => ({ x: s.date, y: s.cityCount })),
)

/** 已达成功业（按定义顺序展示印章） */
const unlockedSeals = computed(() =>
  MILESTONES.filter((m) => store.milestonesUnlocked[m.id]),
)

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

.gom-review {
  width: 100%;
  border-top: 1px dashed rgba(90, 70, 40, 0.25);
  padding: 12px 8px 4px;
  margin-bottom: 12px;
}

.gom-review-title {
  font-family: var(--font-song);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 3px;
  color: var(--ink-panel);
  text-align: center;
  margin-bottom: 10px;
}

.gom-review-chart {
  margin-bottom: 12px;
}

.gom-review-empty {
  font-size: 12px;
  color: var(--ink);
  opacity: 0.55;
  text-align: center;
  padding: 10px 0;
}

.gom-review-seals {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 2px 0 8px;
}

.gom-seal {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-song);
  font-size: 22px;
  font-weight: 700;
  border-radius: 6px;
  user-select: none;
}

.gom-seal--unlocked {
  background: var(--cinnabar);
  color: var(--paper);
  box-shadow: 0 1px 4px rgba(140, 40, 30, 0.35);
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
