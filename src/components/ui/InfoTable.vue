<template>
  <div class="info-table">
    <div v-for="row in rows" :key="row.label" class="info-row">
      <span class="info-label">{{ row.label }}</span>
      <span class="info-value">{{ row.value }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TableRow {
  label: string
  value: string | number
}

defineProps<{
  rows?: TableRow[]
}>()
</script>

<style scoped>
.info-table {
  display: flex;
  flex-direction: column;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: #888;
  font-size: 14px;
}

.info-value {
  color: #ddd;
  font-size: 14px;
  font-weight: 500;
}
</style>
