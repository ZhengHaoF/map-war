<template>
  <div
    v-if="visible"
    class="context-menu"
    :style="{ left: (position?.x ?? 0) + 'px', top: (position?.y ?? 0) + 'px' }"
  >
    <div
      v-for="item in items"
      :key="item.action"
      class="context-menu-item"
      :class="{ danger: item.danger }"
      @click.stop="$emit('select', item.action)"
    >
      {{ item.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
interface MenuItem {
  action: string
  label: string
  danger?: boolean
}

defineProps<{
  visible?: boolean
  position?: { x: number; y: number }
  items?: MenuItem[]
}>()

defineEmits<{
  select: [action: string]
}>()
</script>

<style scoped>
.context-menu {
  position: absolute;
  z-index: 2000;
  background: rgba(20, 20, 40, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 4px;
  min-width: 120px;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.context-menu-item {
  padding: 8px 16px;
  color: #bbb;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
  transition: background 0.15s, color 0.15s;
}

.context-menu-item:hover {
  background: rgba(59, 130, 246, 0.3);
  color: #fff;
}

.context-menu-item.danger:hover {
  background: rgba(244, 68, 68, 0.3);
  color: #ff8888;
}
</style>
