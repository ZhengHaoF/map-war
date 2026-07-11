<template>
  <button class="game-btn" :class="{ active, danger, parchment }" @click="$emit('click', $event)">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  active?: boolean
  danger?: boolean
  parchment?: boolean
}>()

defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.game-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  white-space: nowrap;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(4px);
}

.game-btn :deep(svg) {
  display: block;
  flex-shrink: 0;
}

.game-btn:hover {
  background: rgba(0, 0, 0, 0.8);
  border-color: rgba(255, 255, 255, 0.5);
}

.game-btn.active {
  background: rgba(59, 130, 246, 0.8);
  border-color: rgba(59, 130, 246, 1);
}

.game-btn.danger:hover {
  background: rgba(244, 68, 68, 0.3);
  color: var(--danger-text);
}

/* 羊皮纸/古籍变体 */
.game-btn.parchment {
  border: 1px solid rgba(138, 109, 75, 0.35);
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  color: var(--ink);
  backdrop-filter: none;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.06);
  font-family: var(--font-kai);
  letter-spacing: 1px;
}

.game-btn.parchment:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.55);
  color: var(--ink-strong);
}

.game-btn.parchment.active {
  background: linear-gradient(to bottom, var(--paper-dark), var(--paper-darkest));
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.game-btn.parchment.danger:hover {
  background: linear-gradient(to bottom, var(--danger-bg), var(--danger-bg2));
  border-color: var(--cinnabar);
  color: var(--danger-ink);
}
</style>
