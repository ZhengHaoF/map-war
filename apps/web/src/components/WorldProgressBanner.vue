<template>
  <Transition name="wpb">
    <div v-if="visible" class="world-progress-banner">
      <span class="wpb-seal seal-pulse">{{ sealChar }}</span>
      <div class="wpb-text">
        <div class="wpb-main">{{ mainText }}</div>
        <div class="wpb-sub">{{ subText }}</div>
      </div>
      <span class="wpb-track"><span class="wpb-edge edge-slide"></span></span>

      <!-- 进队栏：待执行指令明细 -->
      <div v-if="queue.length" class="wpb-queue">
        <div class="wpb-queue-head">待执行 {{ queue.length }} 条</div>
        <ul class="wpb-queue-list">
          <li v-for="(o, i) in queuePreview" :key="i" class="wpb-queue-item">
            <span class="wpb-verb">{{ verbOf(o) }}</span>
            <span class="wpb-detail">{{ detailOf(o) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { useGameScheduler } from '@/composables/useGameScheduler'
import type { GameOrder } from '@/utils/gameOrders'
import { describeOrder } from '@/utils/orderText'

const { loading: kernelLoading, phase: kernelPhase, progress: kernelProgress } = useAgentKernel()
const { queue, status: schedStatus } = useGameScheduler()

/** 可见条件：世界推演进行中，或玩家指令正在调度推进中 */
const visible = computed(() => kernelLoading.value || schedStatus.value === 'running')

/** 英文内核阶段 → 中文展示文案 */
function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    idle: '待命',
    classifying: '分析中…',
    ai: '政权 AI 决策中…',
    advancing: '执行指令中…',
    settling: '战斗裁决中…',
    done: '推演完成',
    error: '推演异常',
  }
  return map[phase] ?? phase
}

const mainText = computed(() => {
  if (kernelLoading.value) return kernelProgress.value || phaseLabel(kernelPhase.value)
  if (schedStatus.value === 'running') return `执行指令中…（剩余 ${queue.value.length}）`
  return ''
})

const subText = computed(() => {
  if (kernelLoading.value) return `世界推演 · ${phaseLabel(kernelPhase.value)}`
  if (schedStatus.value === 'running') return '玩家指令 · 推进中'
  return ''
})

/** 钤印单字（随阶段变化） */
const sealChar = computed(() => {
  const m: Record<string, string> = {
    classifying: '析',
    ai: '策',
    advancing: '行',
    settling: '战',
    done: '成',
    error: '误',
  }
  return m[kernelPhase.value] ?? (schedStatus.value === 'running' ? '行' : '流')
})

/** 队列预览（最多 6 条，避免栏过高） */
const queuePreview = computed(() => queue.value.slice(0, 6))

function verbOf(o: GameOrder): string {
  return describeOrder(o).split(' ')[0]
}
function detailOf(o: GameOrder): string {
  const parts = describeOrder(o).split(' ')
  return parts.slice(1).join(' ')
}
</script>

<style scoped>
.world-progress-banner {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 34px;
  z-index: 600;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border-top: 1px solid rgba(138, 109, 75, 0.4);
  border-bottom: 1px solid rgba(138, 109, 75, 0.4);
  box-shadow: 0 -4px 16px rgba(60, 40, 15, 0.18);
  font-family: var(--font-kai);
  color: var(--ink);
}
.wpb-seal {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--cinnabar);
  color: var(--cinnabar-ink, #fbeee6);
  font-size: 17px;
  font-weight: 600;
}
.wpb-text {
  flex: 1;
  min-width: 160px;
}
.wpb-main {
  font-size: 15px;
  letter-spacing: 1px;
}
.wpb-sub {
  font-size: 11px;
  color: var(--ink-soft, #8a6d4b);
  margin-top: 2px;
}
.wpb-track {
  position: relative;
  width: 72px;
  height: 3px;
  border-radius: 2px;
  background: rgba(138, 109, 75, 0.25);
  overflow: hidden;
  flex-shrink: 0;
}
.wpb-edge {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 40%;
  border-radius: 2px;
  background: var(--cinnabar);
}
.seal-pulse {
  animation: sealPulse 2.6s ease-in-out infinite;
}
.edge-slide {
  animation: edgeSlide 1.8s ease-in-out infinite;
}

/* ===== 进队栏：指令明细 ===== */
.wpb-queue {
  flex-basis: 100%;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed rgba(138, 109, 75, 0.35);
}
.wpb-queue-head {
  font-size: 12px;
  color: var(--ink-muted, #9a8560);
  margin-bottom: 5px;
  letter-spacing: 1px;
}
.wpb-queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
}
.wpb-queue-item {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--ink, #3b2a18);
  line-height: 1.5;
}
.wpb-verb {
  flex-shrink: 0;
  color: var(--cinnabar, #b04a3a);
  min-width: 3em;
}
.wpb-detail {
  color: var(--ink-soft, #5a3d1f);
}

@keyframes sealPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.92); }
}
@keyframes edgeSlide {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(280%); }
}
.wpb-enter-active,
.wpb-leave-active {
  transition: transform 0.28s ease, opacity 0.28s ease;
}
.wpb-enter-from,
.wpb-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .seal-pulse,
  .edge-slide {
    animation: none;
  }
  .wpb-enter-active,
  .wpb-leave-active {
    transition: opacity 0.2s ease;
  }
  .wpb-enter-from,
  .wpb-leave-to {
    transform: none;
    opacity: 0;
  }
}
</style>
