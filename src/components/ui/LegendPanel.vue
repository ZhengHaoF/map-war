<template>
  <div class="legend">
    <div v-for="item in items" :key="item.label" class="legend-item">
      <span class="legend-color" :style="{ background: item.color }"></span>
      {{ item.label }}
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    default: () => [],
    // items: [{ label: string, color: string }]
  },
})
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
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  z-index: 1000;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #ccc;
  font-size: 12px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}
</style>
