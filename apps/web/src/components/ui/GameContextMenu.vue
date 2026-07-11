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
      <component :is="ICONS[item.icon]" v-if="item.icon" :size="16" class="menu-icon" />
      <span>{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import IconInfoCircle from '~icons/tabler/info-circle'
import IconSearch from '~icons/tabler/search'
import IconFlag from '~icons/tabler/flag'
import IconBolt from '~icons/tabler/bolt'

interface MenuItem {
  action: string
  label: string
  danger?: boolean
  icon?: string
}

/** 菜单用到的图标查表（unplugin-icons 静态导入 + 运行时查表，保证编译期 tree-shaking） */
const ICONS: Record<string, Component> = {
  'info-circle': IconInfoCircle,
  search: IconSearch,
  flag: IconFlag,
  bolt: IconBolt,
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
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: 4px;
  padding: 4px;
  min-width: 128px;
  box-shadow:
    0 0 0 1px var(--paper-panel) inset,
    0 0 0 2px rgba(138, 109, 75, 0.4) inset,
    0 6px 18px rgba(60, 40, 15, 0.25);
  font-family: var(--font-kai);
  letter-spacing: 1px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  color: var(--ink-mid);
  font-size: 14px;
  cursor: pointer;
  border-radius: 3px;
  user-select: none;
  transition:
    background 0.15s,
    color 0.15s;
}

.context-menu-item .menu-icon {
  flex-shrink: 0;
}

.context-menu-item:hover {
  background: rgba(176, 74, 58, 0.12);
  color: var(--ink-strong);
}

.context-menu-item.danger:hover {
  background: rgba(176, 74, 58, 0.16);
  color: var(--cinnabar);
}
</style>
