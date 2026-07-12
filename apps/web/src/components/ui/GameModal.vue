<template>
  <Teleport defer to="body">
    <div
      v-if="visible"
      class="modal-overlay"
      :class="{ transparent: overlay === false }"
      :style="{ zIndex: zIndex ?? 3000 }"
      @click.self="closable ? $emit('close') : undefined"
    >
      <div
        class="modal"
        :class="{ draggable, parchment: variant === 'parchment' }"
        :style="modalStyle"
      >
        <div class="modal-header" :class="{ draggable }" @mousedown.prevent="onDragStart">
          <span class="modal-title">{{ title }}</span>
          <span v-if="closable" class="modal-close" @click="onCloseClick">&times;</span>
        </div>
        <div class="modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    visible?: boolean
    title?: string
    minWidth?: string
    width?: string
    draggable?: boolean
    overlay?: boolean
    closable?: boolean
    initX?: number
    initY?: number
    /** 弹窗层级，避免多个弹窗共用 3000 时互相遮挡可点区域 */
    zIndex?: number
    /** 主题变体：dark 为默认深色，parchment 为古籍/羊皮纸风格 */
    variant?: 'dark' | 'parchment'
  }>(),
  {
    overlay: true,
    draggable: false,
    visible: false,
    closable: true,
    variant: 'dark',
  },
)

const emit = defineEmits<{
  close: []
}>()

const posX = ref(props.initX ?? 160)
const posY = ref(props.initY ?? 160)
let dragStartX = 0
let dragStartY = 0
let dragOrigX = 0
let dragOrigY = 0
let isDragging = false

const modalStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = { minWidth: props.minWidth ?? '280px' }
  if (props.width) {
    style.width = props.width
  }
  if (props.draggable) {
    style.position = 'fixed'
    style.left = posX.value + 'px'
    style.top = posY.value + 'px'
    style.transform = 'none'
  }
  return style
})

function onDragStart(e: MouseEvent): void {
  if (!props.draggable) return
  isDragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOrigX = posX.value
  dragOrigY = posY.value
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent): void {
  if (!isDragging) return
  posX.value = dragOrigX + (e.clientX - dragStartX)
  posY.value = dragOrigY + (e.clientY - dragStartY)
}

function onDragEnd(): void {
  isDragging = false
  cleanDragListeners()
}

function cleanDragListeners(): void {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
}

onUnmounted(() => {
  cleanDragListeners()
})

function onCloseClick(): void {
  console.log('[GameModal] close button clicked')
  emit('close')
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
  pointer-events: auto;
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

/* 古籍/羊皮纸主题 */
.modal.parchment {
  background: var(--paper-deep);
  border: 1px solid var(--brown-line);
  border-radius: 2px;
  box-shadow:
    0 0 0 1px var(--brown-deep) inset,
    0 0 0 4px var(--paper-deep) inset,
    0 0 0 5px var(--brown-deep) inset,
    0 12px 40px rgba(0, 0, 0, 0.5);
  color: var(--ink-darkest);
}

.modal.parchment .modal-header {
  border-bottom: 1px solid rgba(90, 70, 40, 0.25);
  padding: 14px 20px;
  background: linear-gradient(to bottom, var(--paper-head), var(--paper-head2));
}

.modal.parchment .modal-title {
  color: var(--ink-panel);
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
  letter-spacing: 4px;
  font-size: 16px;
}

.modal.parchment .modal-close {
  color: var(--brown);
}

.modal.parchment .modal-close:hover {
  color: var(--cinnabar);
}

.modal.parchment .modal-body {
  padding: 0;
  background:
    radial-gradient(circle at 20% 30%, rgba(120, 80, 40, 0.04) 0%, transparent 40%),
    radial-gradient(circle at 80% 70%, rgba(120, 80, 40, 0.04) 0%, transparent 40%),
    var(--paper-deep);
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
