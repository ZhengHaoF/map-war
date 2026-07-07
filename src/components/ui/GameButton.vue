<template>
  <button class="game-btn" :class="{ active, danger }" @click="$emit('click', $event)">
    <slot />
  </button>
</template>

<script setup>
defineProps({
  active: { type: Boolean, default: false },
  danger: { type: Boolean, default: false },
})
defineEmits(['click'])
</script>

<style scoped>
.game-btn {
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
  color: #ff8888;
}
</style>
