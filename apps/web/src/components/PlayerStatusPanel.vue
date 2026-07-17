<template>
  <div class="psp" :class="{ collapsed }">
    <!-- 折叠/展开开关 -->
    <button class="psp-toggle" :title="collapsed ? '展开面板' : '收起面板'" @click="collapsed = !collapsed">
      <component :is="collapsed ? ICONS['chevron-left'] : ICONS['chevron-right']" :size="16" />
    </button>

    <!-- 收起态：极简竖条 -->
    <div v-if="collapsed" class="psp-rail" @click="collapsed = false">
      <div class="rail-color" :style="{ background: factionColor }" />
      <div class="rail-metric" title="我方城市数">
        <component :is="ICONS.building" :size="16" />
        {{ myStats.cityCount }}
      </div>
      <div class="rail-metric" title="进行中战斗">
        <component :is="ICONS.crosshair" :size="16" />
        {{ myBattles.length }}
      </div>
      <div class="rail-date">{{ shortDate }}</div>
    </div>

    <!-- 展开态 -->
    <template v-else>
      <header class="psp-header">
        <span class="faction-swatch" :style="{ background: factionColor }" />
        <div class="faction-meta">
          <div class="faction-name">{{ factionLabel }}</div>
          <div v-if="playerName" class="faction-leader">指挥官 · {{ playerName }}</div>
          <div v-else-if="capital" class="faction-capital">都城 · {{ capital }}</div>
        </div>
      </header>

      <div class="psp-body">
        <!-- 领土总览 -->
        <section class="psp-section">
          <h3><component :is="ICONS.building" :size="15" /> 领土总览</h3>
          <div class="stat-grid">
            <div class="stat">
              <span class="stat-num">{{ myStats.cityCount }}</span>
              <span class="stat-label">城市</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ myStats.totalIndustry }}</span>
              <span class="stat-label">总工业</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ myStats.totalFood }}</span>
              <span class="stat-label">总粮食</span>
            </div>
          </div>
          <div v-if="myStats.cityCount" class="level-dist">
            <div v-for="lvl in [5, 4, 3, 2, 1]" :key="lvl" v-show="myStats.levelDistribution[lvl]" class="level-row">
              <span class="level-tag">{{ lvl }}级</span>
              <span class="level-count">{{ myStats.levelDistribution[lvl] }} 城</span>
            </div>
          </div>
          <button class="city-list-toggle" @click="showCities = !showCities">
            <span>城市清单（{{ myStats.cityCount }}）</span>
            <component :is="showCities ? ICONS['chevron-up'] : ICONS['chevron-down']" :size="14" />
          </button>
          <ul v-if="showCities" class="city-list">
            <li v-for="c in myStats.cities" :key="c.gb" @click="focusCity(c.gb)">
              <span class="city-name">{{ c.name }}</span>
              <span class="city-badges">
                <span class="badge lvl">L{{ c.cityLevel }}</span>
                <span class="badge">工{{ c.industry }}</span>
                <span class="badge">粮{{ c.food }}</span>
              </span>
            </li>
          </ul>
        </section>

        <!-- 进行中战斗 -->
        <section class="psp-section">
          <h3><component :is="ICONS.crosshair" :size="15" /> 进行中战斗</h3>
          <div v-if="myBattles.length === 0" class="empty">暂无战斗</div>
          <ul v-else class="battle-list">
            <li v-for="b in myBattles" :key="b.id" @click="focusBattle(b.id)">
              <span class="b-from">{{ b.fromName }}</span>
              <span class="b-arrow">→</span>
              <span class="b-to">{{ b.toName }}</span>
              <span v-if="!b.active" class="inactive">(已停)</span>
            </li>
          </ul>
        </section>

        <!-- 占位模块（数据系统接入中） -->
        <section v-for="ph in placeholders" :key="ph.title" class="psp-section pending">
          <h3><component :is="ph.icon" :size="15" /> {{ ph.title }}</h3>
          <div class="pending-note">待建 · 数据系统接入中</div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { OWNER_LABELS, OWNER_COLORS, OWNER_DETAILS } from '@/data/owners'
import type { Component } from 'vue'
import IconChevronLeft from '~icons/tabler/chevron-left'
import IconChevronRight from '~icons/tabler/chevron-right'
import IconChevronUp from '~icons/tabler/chevron-up'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconBuilding from '~icons/tabler/building'
import IconCrosshair from '~icons/tabler/crosshair'
import IconSword from '~icons/tabler/sword'
import IconAffiliate from '~icons/tabler/affiliate'
import IconAlertTriangle from '~icons/tabler/alert-triangle'
import IconHistory from '~icons/tabler/history'

const ICONS: Record<string, Component> = {
  'chevron-left': IconChevronLeft,
  'chevron-right': IconChevronRight,
  'chevron-up': IconChevronUp,
  'chevron-down': IconChevronDown,
  building: IconBuilding,
  crosshair: IconCrosshair,
  sword: IconSword,
  affiliate: IconAffiliate,
  'alert-triangle': IconAlertTriangle,
  history: IconHistory,
}

const gameStore = useGameStore()

const collapsed = ref(true)
const showCities = ref(false)

const faction = computed(() => gameStore.currentFaction)
const factionLabel = computed(() => (faction.value ? OWNER_LABELS[faction.value] : ''))
const factionColor = computed(() =>
  faction.value ? '#' + (OWNER_COLORS[faction.value] as number).toString(16).padStart(6, '0') : '#888888',
)
const capital = computed(() => (faction.value ? OWNER_DETAILS[faction.value]?.capital ?? '' : ''))
const playerName = computed(() => gameStore.playerName)
const myStats = computed(() => gameStore.myStats)
const myBattles = computed(() => gameStore.myBattles)

const shortDate = computed(() => {
  const d = gameStore.currentDate
  if (!d) return ''
  const p = d.split('-')
  if (p.length !== 3) return d
  return `${parseInt(p[1])}.${parseInt(p[2])}`
})

const placeholders = [
  { title: '军事力量', icon: ICONS.sword },
  { title: '外交态势', icon: ICONS.affiliate },
  { title: '周边威胁', icon: ICONS['alert-triangle'] },
  { title: '事件日志', icon: ICONS.history },
]

function focusCity(gb: string): void {
  gameStore.requestFocus('city', gb)
}
function focusBattle(id: string): void {
  gameStore.requestFocus('battle', id)
}
</script>

<style scoped>
.psp {
  position: fixed;
  top: 16px;
  right: 16px;
  bottom: 44px;
  width: 320px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.45);
  border-radius: 8px;
  box-shadow:
    0 6px 22px rgba(60, 40, 15, 0.28),
    0 0 0 1px rgba(138, 109, 75, 0.25) inset;
  color: var(--ink);
  font-family: var(--font-kai);
  overflow: hidden;
}

.psp.collapsed {
  width: 54px;
}

.psp-toggle {
  position: absolute;
  left: -13px;
  top: 10px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.5);
  border-radius: 50%;
  color: var(--ink);
  cursor: pointer;
  z-index: 2;
  box-shadow: 0 1px 3px rgba(60, 40, 15, 0.25);
}

.psp-toggle:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink);
}

.psp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(to bottom, var(--paper-head), var(--paper-head2));
  border-bottom: 1px solid rgba(138, 109, 75, 0.4);
}

.faction-swatch {
  width: 14px;
  height: 28px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset;
  flex-shrink: 0;
}

.faction-name {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-strong);
  letter-spacing: 2px;
}

.faction-leader,
.faction-capital {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 2px;
  letter-spacing: 1px;
}

.psp-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 12px;
}

.psp-section {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(138, 109, 75, 0.22);
}

.psp-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-panel);
  letter-spacing: 2px;
  margin: 0 0 8px;
  font-weight: 600;
  font-family: var(--font-xing);
}

.psp-section h3 :deep(svg) {
  color: var(--cinnabar);
}

.stat-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.stat {
  flex: 1;
  text-align: center;
  background: var(--paper-faint);
  border: 1px solid rgba(138, 109, 75, 0.3);
  border-radius: 6px;
  padding: 6px 4px;
}

.stat-num {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-strong);
  line-height: 1.1;
}

.stat-label {
  font-size: 11px;
  color: var(--ink-soft);
}

.level-dist {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.level-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-soft);
  background: var(--paper-faint);
  border: 1px solid rgba(138, 109, 75, 0.25);
  border-radius: 4px;
  padding: 2px 7px;
}

.level-tag {
  color: var(--cinnabar-ink);
  font-weight: 600;
}

.city-list-toggle {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid rgba(138, 109, 75, 0.3);
  border-radius: 5px;
  padding: 6px 10px;
  color: var(--ink);
  font-family: var(--font-kai);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  letter-spacing: 1px;
}

.city-list-toggle:hover {
  background: var(--paper-hi);
  border-color: var(--cinnabar);
}

.city-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
}

.city-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s;
}

.city-list li:hover {
  background: var(--paper-hi);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.city-name {
  font-size: 13px;
  color: var(--ink);
}

.city-badges {
  display: flex;
  gap: 4px;
}

.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--paper-darker);
  border: 1px solid rgba(138, 109, 75, 0.3);
  color: var(--ink-soft);
}

.badge.lvl {
  color: var(--cinnabar-ink);
}

.battle-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.battle-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: 5px;
  cursor: pointer;
  background: var(--paper-faint);
  border: 1px solid rgba(138, 109, 75, 0.25);
  margin-bottom: 6px;
  font-size: 13px;
}

.battle-list li:hover {
  background: var(--paper-hi);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.b-arrow {
  color: var(--cinnabar);
}

.inactive {
  color: var(--ink-muted);
  font-size: 11px;
}

.empty {
  color: var(--ink-muted);
  font-size: 12px;
  text-align: center;
  padding: 10px 0;
}

/* 占位模块 */
.psp-section.pending {
  opacity: 0.72;
}

.pending-note {
  font-size: 12px;
  color: var(--ink-muted);
  letter-spacing: 1px;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 6px,
    rgba(138, 109, 75, 0.07) 6px,
    rgba(138, 109, 75, 0.07) 12px
  );
  border: 1px dashed rgba(138, 109, 75, 0.4);
  border-radius: 5px;
  padding: 8px 10px;
}

/* 折叠竖条 */
.psp-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  height: 100%;
  cursor: pointer;
}

.rail-color {
  width: 10px;
  height: 46px;
  border-radius: 3px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset;
}

.rail-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}

.rail-metric :deep(svg) {
  color: var(--ink-soft);
}

.rail-date {
  writing-mode: vertical-rl;
  font-size: 11px;
  color: var(--ink-muted);
  letter-spacing: 2px;
  margin-top: auto;
}

/* 滚动条 */
.psp-body::-webkit-scrollbar,
.city-list::-webkit-scrollbar {
  width: 6px;
}

.psp-body::-webkit-scrollbar-thumb,
.city-list::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: 3px;
}
</style>
