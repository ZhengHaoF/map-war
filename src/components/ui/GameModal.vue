<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" :class="{ transparent: !overlay }">
      <div class="modal" :class="{ draggable }" :style="modalStyle">
        <div
          class="modal-header"
          :class="{ draggable }"
          @mousedown.prevent="onDragStart"
        >
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
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  minWidth: { type: String, default: '280px' },
  draggable: { type: Boolean, default: false },
  overlay: { type: Boolean, default: true },
  initX: { type: Number, default: 160 },
  initY: { type: Number, default: 160 },
})

defineEmits(['close'])

const posX = ref(props.initX)
const posY = ref(props.initY)
let dragStartX = 0
let dragStartY = 0
let dragOrigX = 0
let dragOrigY = 0
let isDragging = false

const modalStyle = computed(() => {
  const style = { minWidth: props.minWidth }
  if (props.draggable) {
    style.position = 'fixed'
    style.left = posX.value + 'px'
    style.top = posY.value + 'px'
    style.transform = 'none'
  }
  return style
})

function onDragStart(e) {
  if (!props.draggable) return
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOrigX = posX.value
  dragOrigY = posY.value
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e) {
  if (!isDragging) return
  posX.value = dragOrigX + (e.clientX - dragStartX)
  posY.value = dragOrigY + (e.clientY - dragStartY)
}

function onDragEnd() {
  isDragging = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
}

onUnmounted(() => {
  cleanDragListeners()
})

function cleanDragListeners() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
}
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

.modal-overlay.transparent {
  background: transparent;
  pointer-events: none;
}

.modal {
  background: rgba(20, 20, 40, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.modal.draggable {
  pointer-events: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header.draggable {
  cursor: grab;
  user-select: none;
}

.modal-header.draggable:active {
  cursor: grabbing;
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
