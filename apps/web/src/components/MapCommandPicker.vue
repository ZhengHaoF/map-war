<template>
  <section class="map-command-picker map-ui" aria-label="地图选城">
    <div role="status" aria-live="polite">
      <div class="picker-heading">
        <span class="picker-step">{{ sourceStep ? '1 / 2' : '2 / 2' }}</span>
        <strong>{{ sourceStep ? `请选择${action}城市` : `请选择${action}目标城市` }}</strong>
      </div>
      <p v-if="!sourceStep" class="picker-source">出发城：{{ sourceName }}</p>
      <p>
        <span class="picker-swatch" aria-hidden="true"></span>
        黄色高亮：{{ candidateCount }} 座{{ sourceStep ? '己方可选城市' : '可选目标城市' }}
        <span v-if="!sourceStep">；蓝色为出发城</span>。
      </p>
      <p class="picker-note">地图选择不发兵、不扣费；选完两座城市后打开行军预览，再确认执行。</p>
      <p v-if="candidateCount === 0" class="picker-error">
        {{ sourceStep ? '暂无己方可选城市。' : '当前没有符合路线、归属及外交条件的目标，请重选出发城或取消。' }}
      </p>
      <p v-if="error" class="picker-error">{{ error }}</p>
    </div>
    <div class="picker-actions">
      <GameButton v-if="!sourceStep" parchment @click="$emit('restart')">重选出发城</GameButton>
      <GameButton parchment @click="$emit('cancel')">取消 · Esc</GameButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MapCommandKind } from '@/composables/useMapCommand'
import GameButton from '@/components/ui/GameButton.vue'

const props = defineProps<{
  kind: MapCommandKind
  phase: 'pickingSource' | 'pickingTarget'
  sourceName: string
  candidateCount: number
  error: string
}>()
defineEmits<{ restart: []; cancel: [] }>()
const action = computed(() => props.kind === 'battle' ? '进攻' : '调兵')
const sourceStep = computed(() => props.phase === 'pickingSource')
</script>

<style scoped>
.map-command-picker {
  position: absolute;
  z-index: 2500;
  top: 100px;
  right: 16px;
  width: min(390px, calc(100% - 196px));
  box-sizing: border-box;
  padding: 12px 14px;
  border: 1px solid var(--ink-soft);
  border-radius: var(--radius-md);
  background: var(--paper, #e2d4b6);
  color: var(--ink);
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(60, 40, 15, 0.2);
}
.picker-heading { display: flex; align-items: center; gap: 8px; }
.picker-step { flex: none; font-size: 11px; padding: 3px 6px; border: 1px solid var(--line-soft); }
.map-command-picker p { margin: 8px 0; font-size: 12px; line-height: 1.5; }
.picker-source { color: var(--ink-strong); }
.picker-swatch { display: inline-block; width: 10px; height: 10px; background: #f6cc38; border: 1px solid #ad7b14; vertical-align: -1px; }
.picker-note { color: var(--ink-soft); }
.picker-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.picker-error { color: var(--cinnabar, #b04a3a); }
@media (max-width: 600px) {
  .map-command-picker { top: auto; bottom: 64px; left: 12px; right: 12px; width: auto; }
}
</style>
