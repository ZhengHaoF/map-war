<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal" :style="{ minWidth: minWidth }">
        <div class="modal-header">
          <span class="modal-title">{{ title }}</span>
          <span class="modal-close" @click="$emit('close')">&times;</span>
        </div>
        <div class="modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  minWidth: { type: String, default: '280px' },
})
defineEmits(['close'])
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.modal {
  background: rgba(20, 20, 40, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-title {
  color: #fff;
  font-size: 18px;
  font-weight: bold;
}

.modal-close {
  color: #888;
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.15s;
}

.modal-close:hover {
  color: #fff;
}

.modal-body {
  padding: 12px 20px 20px;
}
</style>
