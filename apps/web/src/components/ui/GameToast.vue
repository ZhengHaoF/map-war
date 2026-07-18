<template>
  <div class="toast" :class="`toast--${toast.tone}`">
    <span v-if="iconComp" class="toast-icon">
      <component :is="iconComp" :size="24" />
    </span>
    <div class="toast-body">
      <div class="toast-title">{{ toast.title }}</div>
      <div v-if="toast.text" class="toast-text">{{ toast.text }}</div>
    </div>
    <button class="toast-close" :aria-label="'关闭'" @click="onClose">
      <component :is="IconX" :size="16" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToastItem } from '@/composables/useToast'
import IconSword from '~icons/tabler/sword'
import IconFlag from '~icons/tabler/flag'
import IconCrosshair from '~icons/tabler/crosshair'
import IconEye from '~icons/tabler/eye'
import IconPlayerStop from '~icons/tabler/player-stop'
import IconSkull from '~icons/tabler/skull'
import IconCrown from '~icons/tabler/crown'
import IconAlertTriangle from '~icons/tabler/alert-triangle'
import IconCheck from '~icons/tabler/check'
import IconX from '~icons/tabler/x'
import IconClock from '~icons/tabler/clock'
import IconDeviceFloppy from '~icons/tabler/device-floppy'
import IconFileImport from '~icons/tabler/file-import'
import IconTrash from '~icons/tabler/trash'

const props = defineProps<{ toast: ToastItem }>()
const emit = defineEmits<{ dismiss: [id: number] }>()

// 图标注册表：toast.icon 字符串 → 组件
const ICONS: Record<string, unknown> = {
  sword: IconSword,
  flag: IconFlag,
  crosshair: IconCrosshair,
  eye: IconEye,
  'player-stop': IconPlayerStop,
  skull: IconSkull,
  crown: IconCrown,
  'alert-triangle': IconAlertTriangle,
  check: IconCheck,
  clock: IconClock,
  'device-floppy': IconDeviceFloppy,
  'file-import': IconFileImport,
  trash: IconTrash,
}

const iconComp = computed(() => (props.toast.icon ? (ICONS[props.toast.icon] ?? null) : null))

function onClose(): void {
  emit('dismiss', props.toast.id)
}
</script>

<style scoped>
.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 300px;
  max-width: 460px;
  padding: 14px 16px;
  /* 羊皮纸底 + 棕边，呼应 GameModal.parchment */
  background: var(--paper-deep);
  border: 1px solid var(--brown-line);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  box-shadow:
    0 0 0 1px var(--brown-deep) inset,
    0 6px 18px rgba(40, 25, 10, 0.35);
  color: var(--ink-darkest);
  font-family: var(--font-kai), 'KaiTi', 'SimSun', serif;
  pointer-events: auto;
}

/* 色调：左边框 + 图标着色 */
.toast--cinnabar { border-left-color: var(--cinnabar); }
.toast--cinnabar .toast-icon { color: var(--cinnabar); }
.toast--amber { border-left-color: #b45309; }
.toast--amber .toast-icon { color: #b45309; }
.toast--blue { border-left-color: #2e6b8a; }
.toast--blue .toast-icon { color: #2e6b8a; }
.toast--green { border-left-color: #3a7d44; }
.toast--green .toast-icon { color: #3a7d44; }
.toast--purple { border-left-color: #6b4e8a; }
.toast--purple .toast-icon { color: #6b4e8a; }
.toast--neutral { border-left-color: var(--brown); }
.toast--neutral .toast-icon { color: var(--brown); }
.toast--error { border-left-color: var(--danger-ink); }
.toast--error .toast-icon { color: var(--danger-ink); }

.toast-icon {
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
}

.toast-body {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--ink-strong);
}

.toast-text {
  margin-top: 3px;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ink-mid);
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  padding: 2px;
  line-height: 0;
  border-radius: var(--radius-sm);
  transition: color 0.15s, background 0.15s;
}
.toast-close:hover {
  color: var(--cinnabar);
  background: rgba(176, 74, 58, 0.10);
}
</style>
