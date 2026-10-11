<template>
  <Transition name="wpb">
    <div v-if="visible" class="world-progress-banner">
      <span class="wpb-seal seal-pulse">{{ displaySealChar }}</span>
      <div class="wpb-text">
        <div class="wpb-main">{{ displayMainText }}</div>
        <div class="wpb-sub">{{ displaySubText }}</div>
      </div>
      <span class="wpb-track"><span class="wpb-edge edge-slide"></span></span>

      <template v-if="!useCustomProps && kernelLoading && waitDeadlineAt">
        <div class="wpb-wait-summary">
          <span>AI 回复 {{ completedTasks }}/{{ worldAiTasks.length }} 项完成</span>
          <span aria-live="off">{{ waitStopReason === 'cancelled' ? '已停止等待'
            : waitStopReason === 'timeout' ? '截止时间已到'
              : `本回合 AI 截止剩余 ${Math.ceil(waitRemainingMs / 1000)} 秒` }}</span>
        </div>
        <ul class="wpb-tasks" aria-label="世界 AI 请求进度" aria-live="polite">
          <li v-for="task in worldAiTasks" :key="task.id" :data-state="task.state">
            <div class="wpb-task-line"><strong>{{ task.label }}</strong><span>{{ taskStateText(task) }}</span></div>
            <small v-if="task.phase === 'batch'">{{ task.factions.map(f => OWNER_LABELS[f] ?? f).join('、') }}（共享一份批量请求）</small>
          </li>
        </ul>
        <div class="wpb-stop-area">
          <GameButton parchment :disabled="!canStopAiWaiting" @click="stopAiWaiting">
            {{ waitStopReason ? '正在按已有结果结算' : '停止等待并结算' }}
          </GameButton>
          <small>只停止 AI 等待；已取得的决策照常执行，缺失部分标注降级。经济与已执行动作不回滚。</small>
          <small v-if="!aiWaiting && !waitStopReason">本地执行／日期演出期间不能中断；AI 截止不强制终止动作。</small>
        </div>
      </template>

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
import { useAgentKernel, type WorldAiTask } from '@/composables/useAgentKernel'
import { useGameScheduler } from '@/composables/useGameScheduler'
import type { GameOrder } from '@/utils/gameOrders'
import { describeOrder } from '@/utils/orderText'
import { OWNER_LABELS } from '@/data/owners'
import GameButton from '@/components/ui/GameButton.vue'

interface Props {
  /** 外部传入的 loading 状态（可选） */
  loading?: boolean
  /** 自定义主文案（可选） */
  mainText?: string
  /** 自定义副文案（可选） */
  subText?: string
  /** 自定义钤印字（可选） */
  sealChar?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: undefined,
  mainText: undefined,
  subText: undefined,
  sealChar: undefined,
})

const { loading: kernelLoading, phase: kernelPhase, progress: kernelProgress,
  worldAiTasks, aiWaiting, waitDeadlineAt, waitRemainingMs, waitStopReason,
  canStopAiWaiting, stopAiWaiting } = useAgentKernel()
const { queue, status: schedStatus } = useGameScheduler()

/** 是否使用外部传入的自定义状态 */
const useCustomProps = computed(() => props.loading !== undefined)
const completedTasks = computed(() => worldAiTasks.value.filter(task =>
  !['waiting', 'requesting', 'retrying'].includes(task.state)).length)
function taskStateText(task: WorldAiTask): string {
  if (task.state === 'waiting') return '准备请求'
  if (task.state === 'requesting') return `请求 ${task.attempt}/${task.maxAttempts}`
  if (task.state === 'retrying') return `等待重试 ${task.attempt}/${task.maxAttempts}（退避 ${Math.ceil((task.retryDelayMs ?? 0) / 1000)} 秒）`
  if (task.state === 'ok') return '取得有效回复'
  if (task.state === 'empty') return task.phase === 'battleFlavor' ? '本地处理，无需调味请求' : '有效回复，无行动计划'
  if (task.state === 'partial') return '部分可用，详见回执'
  return task.reason === 'timeout' ? '等待超时，使用降级'
    : task.reason === 'cancelled' ? '已停止等待，使用降级'
      : task.reason === 'format' ? '回复格式无效，使用降级' : '请求失败，使用降级'
}

/** 可见条件：使用自定义 props 时看 loading，否则使用全局状态 */
const visible = computed(() => {
  if (useCustomProps.value) return props.loading
  return kernelLoading.value || schedStatus.value === 'running'
})

/** 英文内核阶段 → 中文展示文案 */
function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    idle: '待命',
    classifying: '分析中…',
    ai: '政权 AI 决策中…',
    advancing: '执行指令中…',
    settling: 'AI 结算中…',
    done: '推演完成',
    error: '推演异常',
  }
  return map[phase] ?? phase
}

const displayMainText = computed(() => {
  if (useCustomProps.value) return props.mainText || ''
  if (kernelLoading.value) return kernelProgress.value || phaseLabel(kernelPhase.value)
  if (schedStatus.value === 'running') return `执行指令中…（剩余 ${queue.value.length}）`
  return ''
})

const displaySubText = computed(() => {
  if (useCustomProps.value) return props.subText || ''
  if (kernelLoading.value) return `世界推演 · ${phaseLabel(kernelPhase.value)}`
  if (schedStatus.value === 'running') return '玩家指令 · 推进中'
  return ''
})

/** 钤印单字（随阶段变化） */
const displaySealChar = computed(() => {
  if (useCustomProps.value) return props.sealChar || '流'
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
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 8px 12px;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-md);
  box-shadow: 0 2px 8px rgba(60, 40, 15, 0.12);
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
.wpb-wait-summary { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.wpb-tasks { flex-basis: 100%; margin: 0; padding: 0; list-style: none; max-height: 148px; overflow-y: auto; }
.wpb-tasks li { padding: 6px 0; border-top: 1px solid rgba(138, 109, 75, 0.25); font-size: 12px; }
.wpb-task-line { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; }
.wpb-task-line strong { font-weight: 600; }
.wpb-tasks small { display: block; line-height: 1.6; margin-top: 4px; color: var(--ink-soft); overflow-wrap: anywhere; }
.wpb-tasks [data-state="failed"] { color: var(--cinnabar); }
.wpb-stop-area { flex-basis: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.wpb-stop-area small { font-size: 11px; color: var(--ink-soft); line-height: 1.5; }
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
