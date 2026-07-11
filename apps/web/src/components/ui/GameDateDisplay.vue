<template>
  <div class="date-panel">
    <span class="corner corner-tl" />
    <span class="corner corner-tr" />
    <span class="corner corner-bl" />
    <span class="corner corner-br" />
    <div class="date-left">
      <div class="date-main">{{ formattedDate }}</div>
      <div class="date-sub">
        <span class="sub-line" />
        {{ rocYear }}
        <span class="sub-line" />
      </div>
    </div>
    <template v-if="worldEvent">
      <div class="date-divider" />
      <div class="date-right">
        <div class="date-event">{{ worldEvent }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'

defineProps<{
  worldEvent?: string
}>()

const gameStore = useGameStore()

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const TENS = ['', '十', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十', '一百']

function toChineseNum(n: number): string {
  if (n === 0) return '零'
  if (n < 10) return DIGITS[n]
  if (n < 20) return '十' + (n > 10 ? DIGITS[n - 10] : '')
  if (n < 100) {
    const t = Math.floor(n / 10)
    const u = n % 10
    return TENS[t] + (u > 0 ? DIGITS[u] : '')
  }
  return String(n)
}

const formattedDate = computed(() => {
  const d = gameStore.currentDate
  if (!d) return ''
  const parts = d.split('-')
  if (parts.length !== 3) return d
  const y = parseInt(parts[0])
  const m = parseInt(parts[1])
  const day = parseInt(parts[2])
  return `${y}年${m}月${day}日`
})

const rocYear = computed(() => {
  const d = gameStore.currentDate
  if (!d) return ''
  const y = parseInt(d.split('-')[0])
  if (isNaN(y)) return ''
  const roc = y - 1911
  if (roc < 1) return ''
  return `中华民国${toChineseNum(roc)}年`
})
</script>

<style scoped>
.date-panel {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.4);
  padding: 10px 28px;
  box-shadow:
    0 0 0 1px var(--paper-panel) inset,
    0 0 0 2px rgba(138, 109, 75, 0.4) inset,
    0 6px 18px rgba(60, 40, 15, 0.22);
  user-select: none;
  pointer-events: none;
  font-family: var(--font-kai);
}

.corner {
  position: absolute;
  width: 8px;
  height: 8px;
}

.corner-tl {
  top: 0;
  left: 0;
  border-top: 1px solid rgba(138, 109, 75, 0.7);
  border-left: 1px solid rgba(138, 109, 75, 0.7);
}

.corner-tr {
  top: 0;
  right: 0;
  border-top: 1px solid rgba(138, 109, 75, 0.7);
  border-right: 1px solid rgba(138, 109, 75, 0.7);
}

.corner-bl {
  bottom: 0;
  left: 0;
  border-bottom: 1px solid rgba(138, 109, 75, 0.7);
  border-left: 1px solid rgba(138, 109, 75, 0.7);
}

.corner-br {
  bottom: 0;
  right: 0;
  border-bottom: 1px solid rgba(138, 109, 75, 0.7);
  border-right: 1px solid rgba(138, 109, 75, 0.7);
}

.date-left {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.date-main {
  font-size: 20px;
  color: var(--ink);
  font-weight: 600;
  letter-spacing: 4px;
  line-height: 1.3;
  font-family: var(--font-xing);
}

.date-sub {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-soft);
  letter-spacing: 2px;
}

.sub-line {
  display: inline-block;
  width: 20px;
  height: 1px;
  background: rgba(138, 109, 75, 0.4);
}

.date-divider {
  width: 1px;
  height: 42px;
  background: rgba(138, 109, 75, 0.3);
  margin: 0 24px;
}

.date-right {
  display: flex;
  align-items: center;
}

.date-event {
  font-size: 12px;
  color: var(--cinnabar);
  letter-spacing: 1px;
  white-space: nowrap;
  font-family: var(--font-kai);
}
</style>
