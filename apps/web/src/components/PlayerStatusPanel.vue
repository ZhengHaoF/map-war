<template>
  <GameModal
    :visible="visible"
    title="领土总览"
    width="360px"
    variant="parchment"
    :z-index="2000"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="psp-inner">
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

        <!-- 府库（经济） -->
        <section class="psp-section">
          <h3><component :is="ICONS.coins" :size="15" /> 府库</h3>
          <div class="stat-grid">
            <div class="stat" :class="{ 'stat--deficit': myStats.treasury < 0 }">
              <span class="stat-num">{{ round1(myStats.treasury) }}</span>
              <span class="stat-label">银库（万银）</span>
              <span class="stat-delta" :class="deltaCls(myStats.silverNet)">{{ deltaText(myStats.silverNet) }}</span>
            </div>
            <div class="stat" :class="{ 'stat--deficit': myStats.granary < 0 }">
              <span class="stat-num">{{ round1(myStats.granary) }}</span>
              <span class="stat-label">粮仓（万石）</span>
              <span class="stat-delta" :class="deltaCls(myStats.foodNet)">{{ deltaText(myStats.foodNet) }}</span>
            </div>
          </div>
          <!-- 上回合收支明细（T-1）：玩家本回合看到的是上一回合结算结果 -->
          <div v-if="myStats.hasEconomy" class="ledger">
            <div class="ledger-title">上回合收支（万银 / 万石）</div>
            <div class="ledger-row">
              <span class="ledger-key">税饷</span>
              <span class="ledger-val ledger-in">+{{ myStats.silverTax }}</span>
              <span class="ledger-key">养兵</span>
              <span class="ledger-val ledger-out">−{{ myStats.silverUpkeep }}</span>
              <span class="ledger-key">银净收</span>
              <span class="ledger-val" :class="deltaCls(myStats.silverNet)">{{ deltaText(myStats.silverNet) }}</span>
            </div>
            <div class="ledger-row">
              <span class="ledger-key">粮产</span>
              <span class="ledger-val ledger-in">+{{ myStats.foodProduce }}</span>
              <span class="ledger-key">兵粮</span>
              <span class="ledger-val ledger-out">−{{ myStats.foodUpkeep }}</span>
              <span class="ledger-key">粮净收</span>
              <span class="ledger-val" :class="deltaCls(myStats.foodNet)">{{ deltaText(myStats.foodNet) }}</span>
            </div>
          </div>
          <div v-else class="fund-hint">尚未结算——结束本回合后，此处展示税饷与养兵的逐笔收支。</div>
          <div class="fund-hint">征兵/建设/筑防/整军另耗银两，征兵另耗粮（非每回合固定项）。</div>
        </section>

        <!-- 进行中战斗 -->
        <section class="psp-section">
          <h3><component :is="ICONS.crosshair" :size="15" /> 进行中战斗</h3>
          <div v-if="myBattles.length === 0" class="empty">暂无战斗</div>
          <ul v-else class="battle-list">
            <li v-for="b in myBattles" :key="b.id" @click="focusBattle(b.id)">
              <div class="b-header">
                <span class="b-from">{{ b.fromName }}</span>
                <span class="b-arrow">→</span>
                <span class="b-to">{{ b.toName }}</span>
                <span v-if="b.turns > 0" class="b-turns">第 {{ b.turns }} 回合</span>
                <span v-if="!b.active" class="inactive">(已停)</span>
                <span class="b-trend" :class="battleTrend(b, 'lastTurn').cls">{{ battleTrend(b, 'lastTurn').label }}</span>
              </div>
              <div v-if="b.turns > 0" class="b-body">
                <span class="b-loss b-loss-atk">攻损 {{ b.totalAttackerLoss }}k</span>
                <span class="b-force-bar">
                  <span class="b-force-seg b-force-atk" :style="{ width: bForceShare(b) + '%' }"></span>
                  <span class="b-force-seg b-force-def" :style="{ width: (100 - bForceShare(b)) + '%' }"></span>
                </span>
                <span class="b-loss b-loss-def">守损 {{ b.totalDefenderLoss }}k</span>
              </div>
              <div v-else class="b-body b-body-first">初次交锋——下回合见分晓</div>
            </li>
          </ul>
        </section>

        <!-- 军事力量 -->
        <section class="psp-section">
          <h3><component :is="ICONS.sword" :size="15" /> 军事力量</h3>
          <div class="stat-grid">
            <div class="stat">
              <span class="stat-num">{{ military.totalTroops }}</span>
              <span class="stat-label">总兵力（k）</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ military.morale }}</span>
              <span class="stat-label">士气</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ military.avgFort }}</span>
              <span class="stat-label">平均城防</span>
            </div>
          </div>
          <div class="army-split">
            <span class="split-item">驻军 <b>{{ military.garrisonTroops }}k</b></span>
            <span class="split-item">野战 <b>{{ military.fieldForce }}k</b></span>
            <span class="split-hint">野战为可出击之兵</span>
          </div>
          <button class="city-list-toggle" @click="showArmyCities = !showArmyCities">
            <span>兵力分布（{{ military.cities.length }}）</span>
            <component :is="showArmyCities ? ICONS['chevron-up'] : ICONS['chevron-down']" :size="14" />
          </button>
          <ul v-if="showArmyCities" class="city-list">
            <li v-for="c in military.cities" :key="c.gb" @click="focusCity(c.gb)">
              <span class="city-name">{{ c.name }}</span>
              <span class="city-badges">
                <span class="badge lvl">L{{ c.cityLevel }}</span>
                <span class="badge">驻{{ c.troops }}k</span>
                <span v-if="c.fieldForce" class="badge field">野{{ c.fieldForce }}k</span>
                <span class="badge morale">气{{ c.morale }}</span>
              </span>
            </li>
          </ul>
        </section>

        <!-- 外交态势 -->
        <section class="psp-section">
          <h3><component :is="ICONS.affiliate" :size="15" /> 外交态势</h3>
          <div class="stat-grid">
            <div class="stat" :class="{ 'stat--war': diplo.atWar > 0 }">
              <span class="stat-num">{{ diplo.atWar }}</span>
              <span class="stat-label">交战</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ diplo.allied }}</span>
              <span class="stat-label">同盟</span>
            </div>
            <div class="stat">
              <span class="stat-num">{{ diplo.atPeace }}</span>
              <span class="stat-label">和平</span>
            </div>
          </div>
          <ul v-if="diplo.entries.length" class="diplo-list">
            <li v-for="d in diplo.entries" :key="d.faction" class="diplo-row">
              <span class="diplo-dot" :style="{ background: factionDot(d.faction) }" />
              <span class="diplo-name">{{ d.label }}</span>
              <span class="diplo-troops">{{ d.troops }}k</span>
              <span class="diplo-status" :class="`diplo-status--${d.status}`">{{ statusText(d) }}</span>
              <span v-if="d.status === 'peace' && d.truceUntil" class="diplo-truce">停战至 {{ d.truceUntil }}</span>
            </li>
          </ul>
          <div v-else class="empty">未择势</div>
        </section>

        <!-- 事件日志（最近 12 条，全量见地图面板） -->
        <section class="psp-section">
          <h3><component :is="ICONS.history" :size="15" /> 事件日志</h3>
          <EventLogPanel :limit="12" />
        </section>
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS, OWNER_COLORS, OWNER_DETAILS } from '@/data/owners'
import { round1 } from '@/utils/format'
import { battleTrend, battleForceShare } from '@/utils/battleTrend'
import type { CityState } from '@/stores/game'
import type { Component } from 'vue'
import GameModal from '@/components/ui/GameModal.vue'
import EventLogPanel from '@/components/EventLogPanel.vue'
import IconChevronUp from '~icons/tabler/chevron-up'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconBuilding from '~icons/tabler/building'
import IconCrosshair from '~icons/tabler/crosshair'
import IconSword from '~icons/tabler/sword'
import IconAffiliate from '~icons/tabler/affiliate'
import IconHistory from '~icons/tabler/history'
import IconCoins from '~icons/tabler/coins'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const ICONS: Record<string, Component> = {
  'chevron-up': IconChevronUp,
  'chevron-down': IconChevronDown,
  building: IconBuilding,
  crosshair: IconCrosshair,
  sword: IconSword,
  affiliate: IconAffiliate,
  history: IconHistory,
  coins: IconCoins,
}

const gameStore = useGameStore()

const showCities = ref(false)
const showArmyCities = ref(false)

const faction = computed(() => gameStore.currentFaction)
const factionLabel = computed(() => (faction.value ? OWNER_LABELS[faction.value] : ''))
const factionColor = computed(() =>
  faction.value ? '#' + (OWNER_COLORS[faction.value] as number).toString(16).padStart(6, '0') : '#888888',
)
const capital = computed(() => (faction.value ? OWNER_DETAILS[faction.value]?.capital ?? '' : ''))
const playerName = computed(() => gameStore.playerName)
const myStats = computed(() => gameStore.myStats)
const myBattles = computed(() => gameStore.myBattles)
const military = computed(() => gameStore.myMilitary)
const diplo = computed(() => gameStore.myDiplomacy)

/** 势力色点（hex） */
function factionDot(f: Owner): string {
  const c = OWNER_COLORS[f]
  return c != null ? '#' + c.toString(16).padStart(6, '0') : '#888888'
}

/** 关系状态 → 徽章文案 */
function statusText(d: { status: string; truceUntil?: string }): string {
  if (d.status === 'war') return '交战'
  if (d.status === 'alliance') return '同盟'
  return d.truceUntil ? '停战' : '和平'
}

function focusCity(gb: string): void {
  gameStore.requestFocus('city', gb)
}
function focusBattle(id: string): void {
  gameStore.requestFocus('battle', id)
}
/** 兵力比条：攻方野战 vs 守方驻军 */
function bForceShare(b: { from: string; to: string }): number {
  const cities = gameStore.cities as unknown as Record<string, CityState>
  const atk = cities[b.from]?.fieldForce ?? 0
  const def = cities[b.to]?.troops ?? 0
  return battleForceShare(atk, def)
}

/** 净收支展示文案（带正负号） */
function deltaText(v: number): string {
  const r = round1(v)
  return `${r >= 0 ? '+' : ''}${r}/回合`
}
/** 净收支配色：正=绿、零=灰、负=朱砂 */
function deltaCls(v: number): string {
  if (v > 0) return 'delta--up'
  if (v < 0) return 'delta--down'
  return 'delta--flat'
}
</script>

<style scoped>
.psp-inner {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  overflow: hidden;
}

.psp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(to bottom, var(--paper-head), var(--paper-head2));
  border-bottom: 1px solid rgba(138, 109, 75, 0.4);
  flex-shrink: 0;
}

.faction-swatch {
  width: 14px;
  height: 28px;
  border-radius: var(--radius-sm);
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
  min-height: 0;
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
  border-radius: var(--radius-md);
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

/* 府库净收支 */
.stat-delta {
  display: block;
  font-size: 11px;
  margin-top: 3px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.delta--up { color: #5a7a3a; }
.delta--down { color: var(--cinnabar); }
.delta--flat { color: var(--ink-muted); }
.stat--deficit .stat-num { color: var(--cinnabar); }
.fund-hint {
  font-size: 11px;
  color: var(--ink-muted);
  line-height: 1.6;
  letter-spacing: 0.5px;
  padding: 2px 2px 0;
}
/* ── 上回合收支台账（T-1）── */
.ledger {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--ink-soft) 35%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--paper-hi, #f7efdb) 60%, transparent);
}
.ledger-title {
  font-size: 11px;
  color: var(--ink-soft);
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.ledger-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-size: 12px;
  line-height: 1.9;
}
.ledger-key {
  color: var(--ink-muted);
  font-size: 11px;
}
.ledger-val {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-right: 8px;
}
.ledger-in { color: #5a7a3a; }
.ledger-out { color: var(--ink-soft); }

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
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
  padding: 6px 10px;
  color: var(--ink);
  font-family: var(--font-kai);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  letter-spacing: 1px;
  transition: transform 0.12s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.city-list-toggle:hover {
  background: var(--paper-hi);
  border-color: var(--cinnabar);
}

.city-list-toggle:active {
  transform: scale(0.98);
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
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform 0.1s ease, background 0.12s;
}

.city-list li:hover {
  background: var(--paper-hi);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.city-list li:active {
  transform: scale(0.98);
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
  border-radius: var(--radius-sm);
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
  flex-direction: column;
  gap: 5px;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  background: var(--paper-faint);
  border: 1px solid rgba(138, 109, 75, 0.25);
  margin-bottom: 6px;
  font-size: 13px;
  transition: transform 0.1s ease, background 0.12s;
}

.battle-list li:hover {
  background: var(--paper-hi);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.battle-list li:active {
  transform: scale(0.98);
}

.b-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.b-arrow {
  color: var(--cinnabar);
}

.b-turns {
  font-size: 11px;
  color: var(--ink-muted);
  margin-left: auto;
}

.b-trend {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.trend-atk { color: var(--cinnabar); }
.trend-def { color: #6d5a37; }
.trend-even { color: var(--ink-muted); }

.inactive {
  color: var(--ink-muted);
  font-size: 11px;
}

.b-body {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-muted);
}

.b-body-first {
  color: var(--ink-muted);
  font-style: italic;
}

.b-loss {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.b-loss-atk { color: var(--cinnabar-ink); }
.b-loss-def { color: var(--ink-soft); }

.b-force-bar {
  flex: 1;
  height: 5px;
  display: inline-flex;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(138, 109, 75, 0.18);
}

.b-force-seg { height: 100%; display: block; }
.b-force-atk { background: var(--cinnabar); }
.b-force-def { background: var(--ink-muted); }

.empty {
  color: var(--ink-muted);
  font-size: 12px;
  text-align: center;
  padding: 10px 0;
}

/* ── 军事力量 ── */
.army-split {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 8px;
  padding: 0 2px;
}
.split-item b {
  font-size: 14px;
  color: var(--ink-strong);
  font-variant-numeric: tabular-nums;
}
.split-hint {
  margin-left: auto;
  font-size: 10px;
  color: var(--ink-muted);
}
.badge.field {
  color: #2e6b8a;
  border-color: rgba(46, 107, 138, 0.35);
}
.badge.morale {
  color: var(--cinnabar-ink);
}

/* ── 外交态势 ── */
.diplo-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.diplo-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--radius-md);
  font-size: 12px;
  line-height: 1.8;
  border-bottom: 1px dashed rgba(138, 109, 75, 0.18);
}
.diplo-row:last-child {
  border-bottom: none;
}
.diplo-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15) inset;
}
.diplo-name {
  color: var(--ink);
  letter-spacing: 1px;
  flex-shrink: 0;
}
.diplo-troops {
  color: var(--ink-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.diplo-status {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.diplo-status--war {
  color: var(--cinnabar);
}
.diplo-status--alliance {
  color: #4a8020;
}
.diplo-status--peace {
  color: var(--ink-soft);
}
.diplo-truce {
  font-size: 10px;
  color: var(--ink-muted);
  flex-shrink: 0;
}
.stat--war .stat-num {
  color: var(--cinnabar);
}

/* 滚动条 */
.psp-body::-webkit-scrollbar,
.city-list::-webkit-scrollbar {
  width: 6px;
}

.psp-body::-webkit-scrollbar-thumb,
.city-list::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
}
</style>
