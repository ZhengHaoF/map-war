<template>
  <Transition name="wpb">
    <div v-if="kernelLoading" class="world-progress-banner">
      <span class="wpb-seal seal-pulse">{{ sealChar }}</span>
      <div class="wpb-text">
        <div class="wpb-main">{{ kernelProgress || phaseLabel(kernelPhase) }}</div>
        <div class="wpb-sub">世界推演 · {{ phaseLabel(kernelPhase) }}</div>
      </div>
      <span class="wpb-track"><span class="wpb-edge edge-slide"></span></span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAgentKernel } from '@/composables/useAgentKernel'

const { loading: kernelLoading, phase: kernelPhase, progress: kernelProgress } = useAgentKernel()

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
  return m[kernelPhase.value] ?? '流'
})
</script>

<style scoped>
.world-progress-banner {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 34px;
  z-index: 600;
  display: flex;
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
  min-width: 0;
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
