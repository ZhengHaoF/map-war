<template>
  <GameModal
    :visible="visible"
    title="政权总览"
    width="680px"
    variant="parchment"
    :z-index="4200"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="fdp-shell">
      <!-- 左侧：势力列表导航 -->
      <aside class="fdp-sidebar">
        <div
          v-for="f in ALL_OWNERS"
          :key="f"
          :class="['fdp-faction-item', { active: selectedFaction === f, dead: !isAlive(f) }]"
          @click="selectedFaction = f"
        >
          <span class="faction-dot" :style="{ background: getColor(f) }" />
          <span class="faction-title">{{ OWNER_LABELS[f] ?? f }}</span>
          <span v-if="f === store.currentFaction" class="player-tag">玩家</span>
          <span v-else-if="!isAlive(f)" class="dead-tag">灭亡</span>
        </div>
      </aside>

      <!-- 右侧：选中势力的详细统计 -->
      <main v-if="selectedFaction" class="fdp-main">
        <header class="fdp-head">
          <div class="fdp-head-left">
            <span class="faction-swatch" :style="{ background: getColor(selectedFaction) }" />
            <div>
              <div class="fdp-name">
                {{ OWNER_LABELS[selectedFaction] ?? selectedFaction }}
                <span class="fdp-code">({{ selectedFaction }})</span>
              </div>
              <div class="fdp-sub">
                都城：{{ capital || '无' }} · 领袖：{{ leader || '未知' }}
              </div>
            </div>
          </div>
          <div class="fdp-head-right">
            <GameButton
              v-if="selectedFaction !== store.currentFaction && isAlive(selectedFaction)"
              parchment
              active
              @click="switchPlayer(selectedFaction)"
            >
              切换玩家操控
            </GameButton>
            <span v-else-if="selectedFaction === store.currentFaction" class="fdp-status-pill current">
              当前控制中
            </span>
            <span v-else class="fdp-status-pill dead">已灭亡</span>
          </div>
        </header>

        <div class="fdp-body">
          <!-- 领土 & 经济概览 -->
          <section class="fdp-sec">
            <h4><component :is="ICONS.building" :size="14" /> 领土与实力</h4>
            <div class="stat-grid">
              <div class="stat-box">
                <div class="stat-val">{{ stats.cityCount }}</div>
                <div class="stat-lbl">城池数</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">{{ stats.totalIndustry }}</div>
                <div class="stat-lbl">总工业</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">{{ stats.totalFood }}</div>
                <div class="stat-lbl">总粮食</div>
              </div>
              <div class="stat-box">
                <div class="stat-val">{{ stats.avgFort }}</div>
                <div class="stat-lbl">平均城防</div>
              </div>
            </div>

            <!-- 城市清单（展开/收起） -->
            <div v-if="stats.cityCount > 0" class="city-expander">
              <button class="city-toggle" @click="showCities = !showCities">
                <span>直辖城市清单 ({{ stats.cityCount }})</span>
                <component :is="showCities ? ICONS['chevron-up'] : ICONS['chevron-down']" :size="14" />
              </button>
              <ul v-if="showCities" class="city-chips">
                <li v-for="c in stats.cities" :key="c.gb" class="city-chip" @click="focusCity(c.gb)">
                  <span class="c-name">{{ c.name }}</span>
                  <span class="c-badge">L{{ c.cityLevel }}</span>
                  <span class="c-badge">工{{ c.industry }}</span>
                </li>
              </ul>
            </div>
          </section>

          <!-- 府库与收支 -->
          <section class="fdp-sec">
            <h4><component :is="ICONS.coins" :size="14" /> 府库存量与上回合收支</h4>
            <div class="stat-grid">
              <div class="stat-box" :class="{ deficit: stats.treasury < 0 }">
                <div class="stat-val">{{ stats.treasury }}</div>
                <div class="stat-lbl">银库 (万银)</div>
                <div class="stat-sub" :class="deltaCls(stats.silverNet)">{{ deltaText(stats.silverNet) }}</div>
              </div>
              <div class="stat-box" :class="{ deficit: stats.granary < 0 }">
                <div class="stat-val">{{ stats.granary }}</div>
                <div class="stat-lbl">粮仓 (万石)</div>
                <div class="stat-sub" :class="deltaCls(stats.foodNet)">{{ deltaText(stats.foodNet) }}</div>
              </div>
            </div>

            <div v-if="stats.hasEconomy" class="ledger-card">
              <div class="ledger-line">
                <span>税饷：+{{ stats.silverTax }} 万</span>
                <span>养兵：-{{ stats.silverUpkeep }} 万</span>
                <span class="bold">银净增：{{ deltaText(stats.silverNet) }}</span>
              </div>
              <div class="ledger-line">
                <span>粮产：+{{ stats.foodProduce }} 万</span>
                <span>兵粮：-{{ stats.foodUpkeep }} 万</span>
                <span class="bold">粮净增：{{ deltaText(stats.foodNet) }}</span>
              </div>
            </div>
          </section>

          <!-- 外交态势 -->
          <section class="fdp-sec">
            <h4><component :is="ICONS.affiliate" :size="14" /> 全局外交关系</h4>
            <div class="diplo-grid">
              <div
                v-for="target in otherFactions"
                :key="target"
                class="diplo-item"
              >
                <span class="diplo-target">{{ OWNER_LABELS[target] ?? target }}</span>
                <span :class="['diplo-status', `diplo-${getRelation(target).status}`]">
                  {{ relationText(getRelation(target).status) }}
                </span>
                <span v-if="getRelation(target).truceUntil" class="truce-tag">
                  停战至 {{ getRelation(target).truceUntil }}
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS, OWNER_COLORS, OWNER_DETAILS } from '@/data/owners'
import type { Component } from 'vue'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
import IconBuilding from '~icons/tabler/building'
import IconCoins from '~icons/tabler/coins'
import IconAffiliate from '~icons/tabler/affiliate'
import IconChevronUp from '~icons/tabler/chevron-up'
import IconChevronDown from '~icons/tabler/chevron-down'

import { readRelation } from '@/utils/diplomacy'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const store = useGameStore()
const showCities = ref(false)

const ICONS: Record<string, Component> = {
  building: IconBuilding,
  coins: IconCoins,
  affiliate: IconAffiliate,
  'chevron-up': IconChevronUp,
  'chevron-down': IconChevronDown,
}

// 包含非中立的所有势力列表
const ALL_OWNERS = Object.values(Owner).filter((o) => o !== Owner.NEUTRAL)

const selectedFaction = ref<Owner>(store.currentFaction ?? Owner.KMT)

function isAlive(f: Owner): boolean {
  return store.activeFactions.includes(f)
}

function getColor(f: Owner): string {
  const c = OWNER_COLORS[f]
  return c ? '#' + (c as number).toString(16).padStart(6, '0') : '#888888'
}

const stats = computed(() => store.getFactionStats(selectedFaction.value))
const leader = computed(() => OWNER_DETAILS[selectedFaction.value]?.leader ?? '')
const capital = computed(() => OWNER_DETAILS[selectedFaction.value]?.capital ?? '')

const otherFactions = computed(() =>
  ALL_OWNERS.filter((f) => f !== selectedFaction.value && isAlive(f)),
)

function getRelation(target: Owner) {
  return readRelation(store.relations, selectedFaction.value, target)
}

function relationText(st: string): string {
  if (st === 'war') return '交战 ⚔️'
  if (st === 'alliance') return '同盟 🤝'
  return '和平 🕊️'
}

function switchPlayer(f: Owner) {
  store.currentFaction = f
}

function focusCity(gb: string) {
  store.requestFocus('city', gb)
}

function deltaText(v: number): string {
  return `${v >= 0 ? '+' : ''}${v}/回合`
}
function deltaCls(v: number): string {
  if (v > 0) return 'delta-up'
  if (v < 0) return 'delta-down'
  return 'delta-flat'
}
</script>

<style scoped>
.fdp-shell {
  display: flex;
  height: 520px;
  max-height: 75vh;
  gap: 12px;
  padding: 10px;
}

/* Sidebar */
.fdp-sidebar {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  border-right: 1px solid rgba(138, 109, 75, 0.25);
  padding-right: 8px;
}

.fdp-faction-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--paper-faint, #f4ecd8);
  border: 1px solid transparent;
  transition: all 0.15s;
}

.fdp-faction-item:hover {
  background: var(--paper-hi, #fbf7ee);
  border-color: rgba(138, 109, 75, 0.4);
}

.fdp-faction-item.active {
  background: var(--paper-head, #e5d7b8);
  border-color: var(--cinnabar, #b04a3a);
  font-weight: bold;
}

.fdp-faction-item.dead {
  opacity: 0.55;
  filter: grayscale(0.5);
}

.faction-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.faction-title {
  font-size: 13px;
  color: var(--ink-strong, #2b1d0c);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-tag {
  font-size: 10px;
  background: var(--cinnabar, #b04a3a);
  color: #fff;
  padding: 1px 4px;
  border-radius: 3px;
}

.dead-tag {
  font-size: 10px;
  color: #888;
}

/* Main */
.fdp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fdp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--paper-head, #e5d7b8);
  border-radius: 4px;
  margin-bottom: 10px;
}

.fdp-head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.faction-swatch {
  width: 12px;
  height: 32px;
  border-radius: 3px;
}

.fdp-name {
  font-size: 16px;
  font-weight: bold;
  color: var(--ink-strong, #2b1d0c);
}

.fdp-code {
  font-size: 12px;
  color: var(--ink-soft, #7a5c38);
  font-weight: normal;
}

.fdp-sub {
  font-size: 12px;
  color: var(--ink-soft, #7a5c38);
}

.fdp-status-pill {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 99px;
}
.fdp-status-pill.current {
  background: rgba(74, 128, 32, 0.15);
  color: #4a8020;
}
.fdp-status-pill.dead {
  background: rgba(0, 0, 0, 0.1);
  color: #777;
}

.fdp-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.fdp-sec {
  padding: 8px;
  border: 1px solid rgba(138, 109, 75, 0.2);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
}

.fdp-sec h4 {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ink-strong, #2b1d0c);
  margin: 0 0 8px 0;
  border-bottom: 1px dashed rgba(138, 109, 75, 0.3);
  padding-bottom: 4px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.stat-box {
  background: var(--paper-faint, #f4ecd8);
  border: 1px solid rgba(138, 109, 75, 0.25);
  border-radius: 4px;
  padding: 6px;
  text-align: center;
}

.stat-box.deficit .stat-val {
  color: var(--cinnabar, #b04a3a);
}

.stat-val {
  font-size: 16px;
  font-weight: bold;
  color: var(--ink-strong, #2b1d0c);
}

.stat-lbl {
  font-size: 11px;
  color: var(--ink-soft, #7a5c38);
}

.stat-sub {
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
}
.delta-up { color: #4a8020; }
.delta-down { color: var(--cinnabar, #b04a3a); }
.delta-flat { color: #888; }

.city-expander {
  margin-top: 8px;
}

.city-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: transparent;
  border: 1px solid rgba(138, 109, 75, 0.3);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--ink-soft, #7a5c38);
  cursor: pointer;
}

.city-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  list-style: none;
  padding: 6px 0 0 0;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
}

.city-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--paper-head, #e5d7b8);
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}

.city-chip:hover {
  background: var(--paper-hi, #fbf7ee);
}

.c-badge {
  font-size: 10px;
  color: var(--cinnabar, #b04a3a);
}

.ledger-card {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(138, 109, 75, 0.08);
  border-radius: 4px;
  font-size: 12px;
}

.ledger-line {
  display: flex;
  gap: 12px;
  line-height: 1.6;
}

.ledger-line .bold {
  font-weight: bold;
  margin-left: auto;
}

.diplo-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.diplo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--paper-faint, #f4ecd8);
  border-radius: 4px;
  font-size: 12px;
}

.diplo-target {
  font-weight: 600;
}

.diplo-status {
  font-size: 11px;
}
.diplo-war { color: var(--cinnabar, #b04a3a); }
.diplo-alliance { color: #4a8020; }
.diplo-peace { color: var(--ink-soft, #7a5c38); }

.truce-tag {
  font-size: 10px;
  color: #b04a3a;
  margin-left: 4px;
}
</style>
