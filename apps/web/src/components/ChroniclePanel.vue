<template>
  <GameModal
    :visible="visible"
    title="战纪"
    width="440px"
    variant="parchment"
    :z-index="2000"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="cp-inner">
      <!-- 统一度进度条：雪球的可见刻度 -->
      <div class="cp-progress">
        <div class="cp-progress-head">
          <span class="cp-progress-label">统一度</span>
          <span class="cp-progress-count">{{ myCities.length }} / {{ totalCities }} 城</span>
        </div>
        <div class="cp-progress-track">
          <div class="cp-progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
      </div>

      <!-- 三 tab -->
      <div class="cp-tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="cp-tab"
          :class="{ active: activeTab === t.key }"
          @click="activeTab = t.key"
        >
          <component :is="t.icon" :size="14" />
          {{ t.label }}
        </button>
      </div>

      <div class="cp-body">
        <!-- ── 扩张轨迹 ── -->
        <section v-if="activeTab === 'expansion'" class="cp-section">
          <div v-if="timeline.length === 0" class="cp-empty">
            尚未攻城略地，江山待开疆。
          </div>
          <ol v-else class="cp-timeline">
            <li v-for="(e, i) in timeline" :key="i" class="cp-tl-item" @click="focusCity(e.gb)">
              <span class="cp-tl-node"></span>
              <span class="cp-tl-date">{{ e.date.slice(0, 7) }}</span>
              <span class="cp-tl-action">克</span>
              <span class="cp-tl-name">{{ e.name }}</span>
            </li>
          </ol>
        </section>

        <!-- ── 势力沉浮 ── -->
        <section v-else-if="activeTab === 'trend'" class="cp-section">
          <div class="cp-metrics">
            <button
              v-for="m in METRICS"
              :key="m.key"
              class="cp-metric"
              :class="{ active: activeMetric === m.key }"
              @click="activeMetric = m.key"
            >
              {{ m.label }}
            </button>
          </div>
          <TrendChart :points="trendPoints" :unit="activeMetricUnit" :metric="activeMetricLabel" />
        </section>

        <!-- ── 功业 ── -->
        <section v-else class="cp-section">
          <div v-for="g in tierGroups" :key="g.tier" class="cp-tier">
            <h4 class="cp-tier-title">
              {{ g.label }}
              <span class="cp-tier-count">{{ g.done }}/{{ g.items.length }}</span>
            </h4>
            <div class="cp-seals">
              <div
                v-for="m in g.items"
                :key="m.id"
                class="cp-seal"
                :class="{ sealed: !!unlocked[m.id] }"
              >
                <span class="cp-seal-stamp">{{ unlocked[m.id] ? m.sealChar : '?' }}</span>
                <span class="cp-seal-title">{{ m.title }}</span>
                <span v-if="unlocked[m.id]" class="cp-seal-date">{{ unlocked[m.id].date.slice(0, 7) }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed, type Component } from 'vue'
import { useGameStore } from '@/stores/game'
import { buildExpansionTimeline } from '@/utils/chronicle'
import { MILESTONES, MILESTONE_TIER_LABELS, type MilestoneDef } from '@/data/milestones'
import GameModal from '@/components/ui/GameModal.vue'
import TrendChart from '@/components/ui/TrendChart.vue'
import IconTimeline from '~icons/tabler/timeline'
import IconChartLine from '~icons/tabler/chart-line'
import IconRosette from '~icons/tabler/rosette'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const store = useGameStore()

const activeTab = ref<'expansion' | 'trend' | 'milestone'>('expansion')
const activeMetric = ref<'cityCount' | 'troops' | 'morale' | 'treasury' | 'granary'>('cityCount')

const TABS: { key: 'expansion' | 'trend' | 'milestone'; label: string; icon: Component }[] = [
  { key: 'expansion', label: '扩张轨迹', icon: IconTimeline },
  { key: 'trend', label: '势力沉浮', icon: IconChartLine },
  { key: 'milestone', label: '功业', icon: IconRosette },
]

const METRICS: { key: 'cityCount' | 'troops' | 'morale' | 'treasury' | 'granary'; label: string; unit: string }[] = [
  { key: 'cityCount', label: '城池', unit: '城' },
  { key: 'troops', label: '兵力', unit: 'k' },
  { key: 'morale', label: '士气', unit: '' },
  { key: 'treasury', label: '银库', unit: '万银' },
  { key: 'granary', label: '粮仓', unit: '万石' },
]

// ── 统一度 ──
const myCities = computed(() => store.myCities)
const totalCities = computed(() => Object.keys(store.cities).length)
const progressPct = computed(() => {
  const t = totalCities.value
  if (!t) return 0
  return Math.min(100, Math.round((myCities.value.length / t) * 100))
})

// ── 扩张轨迹 ──
const timeline = computed(() => {
  const f = store.currentFaction
  if (!f) return []
  // 倒序：最新占领在前
  return buildExpansionTimeline(store.eventLog, f, store.cities).reverse()
})

function focusCity(gb: string): void {
  store.requestFocus('city', gb)
}

// ── 势力沉浮 ──
const trendPoints = computed(() =>
  store.turnSnapshots.map((s) => ({ x: s.date, y: s[activeMetric.value] })),
)
const activeMetricLabel = computed(() => METRICS.find((m) => m.key === activeMetric.value)?.label ?? '')
const activeMetricUnit = computed(() => METRICS.find((m) => m.key === activeMetric.value)?.unit ?? '')

// ── 功业 ──
const unlocked = computed(() => store.milestonesUnlocked)

const tierGroups = computed(() => {
  const map = new Map<number, MilestoneDef[]>()
  for (const m of MILESTONES) {
    if (!map.has(m.tier)) map.set(m.tier, [])
    map.get(m.tier)!.push(m)
  }
  return [1, 2, 3]
    .filter((t) => map.has(t))
    .map((t) => ({
      tier: t as 1 | 2 | 3,
      label: MILESTONE_TIER_LABELS[t as 1 | 2 | 3],
      items: map.get(t)!,
      done: map.get(t)!.filter((m) => unlocked.value[m.id]).length,
    }))
})
</script>

<style scoped>
.cp-inner {
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  overflow: hidden;
}

/* ── 统一度进度条 ── */
.cp-progress {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(138, 109, 75, 0.22);
}
.cp-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.cp-progress-label {
  font-size: 13px;
  color: var(--ink-panel);
  font-weight: 600;
  letter-spacing: 2px;
  font-family: var(--font-xing);
}
.cp-progress-count {
  font-size: 12px;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
}
.cp-progress-track {
  height: 8px;
  border-radius: 4px;
  background: var(--paper-darker);
  border: 1px solid rgba(138, 109, 75, 0.35);
  overflow: hidden;
}
.cp-progress-fill {
  height: 100%;
  background: linear-gradient(to right, var(--cinnabar-soft, #c96a4e), var(--cinnabar));
  border-radius: 4px;
  transition: width 0.5s ease;
}

/* ── tabs ── */
.cp-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid rgba(138, 109, 75, 0.25);
}
.cp-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 4px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ink-soft);
  font-family: var(--font-kai);
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cp-tab:hover {
  color: var(--ink);
}
.cp-tab.active {
  color: var(--cinnabar);
  border-bottom-color: var(--cinnabar);
  font-weight: 600;
}

.cp-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 12px 14px;
}

/* ── 扩张轨迹 ── */
.cp-empty {
  text-align: center;
  color: var(--ink-muted);
  font-size: 12px;
  padding: 32px 0;
}
.cp-timeline {
  list-style: none;
  margin: 0;
  padding: 4px 0 4px 6px;
}
.cp-tl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
  border-left: 2px solid transparent;
}
.cp-tl-item:hover {
  background: var(--paper-hi);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}
.cp-tl-node {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--cinnabar);
  box-shadow: 0 0 0 2px var(--paper-deep), 0 0 0 3px rgba(176, 74, 58, 0.35);
}
.cp-tl-date {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
.cp-tl-action {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--cinnabar);
  font-weight: 600;
}
.cp-tl-name {
  color: var(--ink);
  letter-spacing: 1px;
}

/* ── 势力沉浮 ── */
.cp-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.cp-metric {
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(138, 109, 75, 0.3);
  background: var(--paper-faint);
  color: var(--ink-soft);
  font-family: var(--font-kai);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.cp-metric:hover {
  border-color: var(--cinnabar);
}
.cp-metric.active {
  background: var(--cinnabar);
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink, #fbeee6);
  font-weight: 600;
}

/* ── 功业（印章墙） ── */
.cp-tier {
  margin-bottom: 14px;
}
.cp-tier-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-xing);
  font-size: 13px;
  color: var(--ink-panel);
  letter-spacing: 2px;
  margin: 0 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(138, 109, 75, 0.2);
}
.cp-tier-count {
  font-size: 11px;
  color: var(--ink-muted);
  letter-spacing: 0;
}
.cp-seals {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.cp-seal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px 6px;
  border: 1px dashed rgba(138, 109, 75, 0.35);
  border-radius: var(--radius-md);
  background: var(--paper-faint);
}
.cp-seal-stamp {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-family: var(--font-xing);
  font-size: 19px;
  font-weight: 600;
  border: 1.5px solid rgba(138, 109, 75, 0.45);
  color: var(--ink-muted);
  background: transparent;
}
.cp-seal.sealed {
  border-style: solid;
  border-color: rgba(176, 74, 58, 0.45);
  background: rgba(176, 74, 58, 0.06);
}
.cp-seal.sealed .cp-seal-stamp {
  background: var(--cinnabar);
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink, #fbeee6);
  box-shadow: 0 0 0 2px var(--paper-deep), 0 0 0 3px rgba(176, 74, 58, 0.3);
}
.cp-seal-title {
  font-size: 11px;
  color: var(--ink-soft);
  text-align: center;
  line-height: 1.4;
}
.cp-seal.sealed .cp-seal-title {
  color: var(--ink);
  font-weight: 600;
}
.cp-seal-date {
  font-size: 10px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
</style>
