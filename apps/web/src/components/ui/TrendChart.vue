<template>
  <div class="tc">
    <div v-if="pts.length < 2" class="tc-empty">尚无足够回合数据</div>
    <svg v-else :viewBox="`0 0 ${W} ${H}`" class="tc-svg" role="img">
      <title>趋势图 · {{ metricLabel }}</title>
      <!-- Y 轴淡格线 + 刻度 -->
      <line
        v-for="gy in gridYs"
        :key="gy.y"
        :x1="padL"
        :y1="gy.y"
        :x2="W - padR"
        :y2="gy.y"
        class="tc-grid"
      />
      <text :x="2" :y="padT + 4" class="tc-ylab">{{ yMax }}</text>
      <text :x="2" :y="H - padB" class="tc-ylab">{{ yMin }}</text>
      <!-- 折线 -->
      <polyline :points="linePoints" class="tc-line" :stroke="stroke" />
      <!-- X 轴日期标（首 / 中 / 末） -->
      <text
        v-for="l in xLabels"
        :key="l.text"
        :x="l.x"
        :y="H - 6"
        class="tc-xlab"
        text-anchor="middle"
      >
        {{ l.text }}
      </text>
      <!-- 数据点（hover 原生 title） -->
      <g v-for="(p, i) in pts" :key="i">
        <circle :cx="p.x" :cy="p.y" r="3.2" class="tc-dot" :fill="stroke" />
        <title>{{ p.date }} · {{ p.value }}{{ unit }}</title>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Pt {
  x: string
  y: number
}

const props = withDefaults(
  defineProps<{
    /** 采样点：x = 回合日期（ISO），y = 数值 */
    points: Pt[]
    /** 折线颜色（CSS 值），默认水墨墨色 */
    color?: string
    /** 数值单位后缀（tooltip 用） */
    unit?: string
    /** 指标名（svg title 用） */
    metric?: string
  }>(),
  {
    color: 'var(--ink)',
    unit: '',
    metric: '',
  },
)

const W = 560
const H = 170
const padL = 42
const padR = 10
const padT = 16
const padB = 26

const metricLabel = computed(() => props.metric || '数值')

const nums = computed(() => props.points.map((p) => p.y))
const yMin = computed(() => {
  const arr = nums.value
  return arr.length ? Math.min(...arr) : 0
})
const yMax = computed(() => {
  const arr = nums.value
  return arr.length ? Math.max(...arr) : 1
})

const pts = computed(() => {
  const arr = props.points
  const n = arr.length
  if (n < 2) return []
  const lo = yMin.value
  const span = yMax.value - lo || 1
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  return arr.map((p, i) => ({
    x: padL + (i * plotW) / (n - 1),
    y: padT + (1 - (p.y - lo) / span) * plotH,
    date: p.x,
    value: p.y,
  }))
})

const linePoints = computed(() => pts.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))

/** Y 轴 3 条淡格线（上 / 中 / 下） */
const gridYs = computed(() => {
  const plotH = H - padT - padB
  return [0, 0.5, 1].map((f) => ({ y: padT + f * plotH }))
})

/** X 轴首 / 中 / 末日期标（取年-月，避免过长） */
const xLabels = computed(() => {
  const arr = props.points
  const n = arr.length
  if (n < 2) return []
  const idxs = [0, Math.floor((n - 1) / 2), n - 1]
  return idxs.map((i) => ({ x: pts.value[i].x, text: arr[i].x.slice(0, 7) }))
})

const stroke = computed(() => props.color)
</script>

<style scoped>
.tc {
  width: 100%;
}
.tc-svg {
  width: 100%;
  height: auto;
  display: block;
}
.tc-grid {
  stroke: rgba(90, 70, 40, 0.16);
  stroke-width: 0.5;
}
.tc-line {
  fill: none;
  stroke-width: 1.6;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.tc-dot {
  stroke: var(--paper-deep);
  stroke-width: 0.8;
}
.tc-ylab {
  font-size: 10px;
  fill: var(--ink-muted);
  dominant-baseline: central;
}
.tc-xlab {
  font-size: 10px;
  fill: var(--ink-muted);
}
.tc-empty {
  text-align: center;
  color: var(--ink-muted);
  font-size: 12px;
  padding: 32px 0;
}
</style>
