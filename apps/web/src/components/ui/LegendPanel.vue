<template>
  <div class="legend">
    <div v-for="item in items" :key="item.label" class="legend-item">
      <span class="legend-color" :style="{ background: item.color }"></span>
      {{ item.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
interface LegendItem {
  label: string
  color: string
}

defineProps<{
  items?: LegendItem[]
}>()
</script>

<style scoped>
.legend {
  position: absolute;
  bottom: 40px;
  left: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  max-width: 360px;
  padding: 12px 16px;
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
  box-shadow:
    0 0 0 1px var(--paper-panel) inset,
    0 0 0 2px rgba(138, 109, 75, 0.4) inset,
    0 4px 14px rgba(60, 40, 15, 0.22);
  z-index: 1000;
  font-family: var(--font-kai);
  letter-spacing: 1px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-mid);
  font-size: 12px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-xs);
  display: inline-block;
  box-shadow: 0 0 0 1px rgba(60, 40, 15, 0.18);
}
</style>
