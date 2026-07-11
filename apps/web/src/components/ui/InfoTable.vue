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
  padding: 16px 20px;
  font-family: var(--font-kai);
}

.info-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--brown-line-faint);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--ink-soft);
  font-size: 14px;
  letter-spacing: 1px;
  flex-shrink: 0;
}

.info-value {
  color: var(--ink);
  font-size: 14px;
  font-weight: 500;
  text-align: right;
  word-break: break-word;
  min-width: 0;
}
</style>
