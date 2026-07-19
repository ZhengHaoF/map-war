<template>
  <div class="ai-dock">
    <div class="dock-head">
      <span class="dock-title"><IconBrain :size="16" />玩家 AI 操作台</span>
      <button class="dock-collapse" :title="collapsed ? '展开' : '收起'" @click="$emit('toggle')">
        <IconChevronUp v-if="collapsed" :size="16" />
        <IconChevronDown v-else :size="16" />
      </button>
    </div>

    <Transition name="dock-collapse">
      <div v-if="!collapsed" class="dock-body">
        <!-- 错误提示（独立于左右布局，横贯顶部） -->
        <div v-if="error || parseError || worldValidationError" class="dock-error">{{ error || parseError || worldValidationError }}</div>

        <div class="dock-main">
          <!-- 左栏：输入 -->
          <div class="dock-left">
            <div class="dock-input-wrap">
              <textarea
                v-model="userMessage"
                class="dock-textarea"
                rows="3"
                placeholder="例如：派兵进攻杭州"
                @keydown.enter.exact.prevent="onSend"
              ></textarea>
              <div class="dock-btns">
                <GameButton parchment :disabled="loading" @click="onSend">
                  <IconSend :size="16" />{{ loading ? '请求中' : '发送' }}
                </GameButton>
                <GameButton parchment size="small" :disabled="!undoStack.length" @click="undo">
                  <IconUndo :size="14" />撤销
                </GameButton>
              </div>
            </div>
          </div>

          <!-- 右栏：操作日志 + 状态 -->
          <div class="dock-right-col">
            <div ref="logRef" class="dock-right">
              <div v-if="chatHistory.length === 0" class="dock-empty">暂无操作记录</div>
              <div v-for="(entry, i) in chatHistory" :key="i" class="log-entry">
                <div class="log-user">▶ {{ entry.user }}</div>
                <div v-if="entry.msg" class="log-msg">{{ entry.msg }}</div>
                <div v-if="entry.orders.length" class="log-orders">
                  <span
                    v-for="(o, j) in entry.orders"
                    :key="j"
                    class="log-dot"
                    :class="{ bad: o.endsWith('✗') }"
                  >● {{ o }}</span>
                </div>
                <!-- 世界AI校验状态 -->
                <div v-if="entry.validationSummary" class="log-validation-summary">
                  {{ entry.validationSummary }}
                </div>
                <!-- 被拒指令 + 理由（硬编码规则） -->
                <div v-if="entry.rejected?.length" class="log-rejected">
                  <div v-for="(r, k) in entry.rejected" :key="k" class="log-rejected-item">
                    <span class="log-rejected-label">✕ {{ r.label }}</span>
                    <span class="log-rejected-reason">{{ r.reason }}</span>
                  </div>
                </div>
                <!-- 世界AI：困难指令 -->
                <div v-if="entry.difficult?.length" class="log-difficult">
                  <div v-for="(r, k) in entry.difficult" :key="k" class="log-difficult-item">
                    <span class="log-difficult-label">{{ r.label }}</span>
                    <span class="log-difficult-reason">{{ r.reason }}</span>
                    <span v-if="r.suggestion" class="log-difficult-suggestion">💡 {{ r.suggestion }}</span>
                  </div>
                </div>
                <!-- 世界AI：不可能指令 -->
                <div v-if="entry.impossible?.length" class="log-impossible">
                  <div v-for="(r, k) in entry.impossible" :key="k" class="log-impossible-item">
                    <span class="log-impossible-label">{{ r.label }}</span>
                    <span class="log-impossible-reason">{{ r.reason }}</span>
                    <span v-if="r.suggestion" class="log-impossible-suggestion">⇢ {{ r.suggestion }}</span>
                  </div>
                </div>
              </div>
              <!-- 世界AI校验进行中 -->
              <div v-if="worldValidationLoading" class="log-validating">
                <span class="log-validating-spin">⟳</span> 世界AI校验中…
              </div>
            </div>
            <div class="dock-status">
              <span class="dock-queue">队列 {{ queue.length }} · {{ statusText }}</span>
              <span v-if="status === 'stopped'" class="dock-stopped">
                ⏸ 已在 {{ stoppedAt?.order }} 处停下
              </span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useAiDebug } from '@/composables/useAiDebug'
import { useGameScheduler } from '@/composables/useGameScheduler'
import GameButton from '@/components/ui/GameButton.vue'
import IconBrain from '~icons/tabler/brain'
import IconSend from '~icons/tabler/send'
import IconUndo from '~icons/tabler/arrow-back-up'
import IconChevronUp from '~icons/tabler/chevron-up'
import IconChevronDown from '~icons/tabler/chevron-down'

defineProps<{ collapsed?: boolean }>()
defineEmits<{ (e: 'toggle'): void }>()

interface ChatEntry {
  user: string
  msg: string | null
  orders: string[]
  /** 硬编码规则拒绝的指令 */
  rejected?: { label: string; reason: string }[]
  /** 世界AI认为困难（⚠ amber）的指令 + 建议 */
  difficult?: { label: string; reason: string; suggestion?: string }[]
  /** 世界AI认为不可能（❌ red）的指令 + 建议 */
  impossible?: { label: string; reason: string; suggestion?: string }[]
  /** 世界AI校验摘要 */
  validationSummary?: string
}

const {
  userMessage,
  loading,
  error,
  parsed,
  parseError,
  aiMessage,
  undoStack,
  strategicRejected,
  worldValidation,
  worldValidationLoading,
  worldValidationError,
  worldDifficult,
  worldImpossible,
  runSend,
  applyStrategicRules,
  validateWithWorldAi,
  getFinalApprovedOrders,
  undo,
} = useAiDebug('user')

const { queue, status, stoppedAt, submit, advance } = useGameScheduler()

const statusText = computed(() => {
  switch (status.value) {
    case 'running': return '推进中…'
    case 'done': return '已跑完'
    case 'stopped': return '已停下'
    default: return '空闲'
  }
})

const chatHistory = ref<ChatEntry[]>([])
const logRef = ref<HTMLElement | null>(null)

async function onSend(): Promise<void> {
  const userText = userMessage.value.trim()
  if (!userText) return

  // ── Phase 1：玩家代理 AI 产出指令 ──
  await runSend()

  // 收集指令摘要（含结构校验结果）
  const orderItems: string[] = []
  if (parsed.value) {
    for (let i = 0; i < parsed.value.orders.length; i++) {
      const errs = parsed.value.errors[i]
      orderItems.push(errs.length ? `${parsed.value.orders[i].order} ✗` : `${parsed.value.orders[i].order} ✓`)
    }
  }

  // ── Phase 2：硬编码战略规则（同步，零延迟）──
  applyStrategicRules()

  // ── Phase 3：世界AI 校验（异步，额外 LLM 调用）──
  if (parsed.value && !parseError.value) {
    await validateWithWorldAi(userText)
  }

  // ── 汇总拒绝 / 困难 / 不可能 ──
  const rejectedItems: { label: string; reason: string }[] = []
  for (const r of strategicRejected.value) {
    rejectedItems.push({ label: r.order.order, reason: r.reason })
  }

  const difficultItems: { label: string; reason: string; suggestion?: string }[] = []
  for (const r of worldDifficult.value) {
    const orderName = (r.order as any)?.order || '未知'
    difficultItems.push({ label: `⚠ ${orderName}`, reason: r.reason, suggestion: r.suggestion })
  }

  const impossibleItems: { label: string; reason: string; suggestion?: string }[] = []
  for (const r of worldImpossible.value) {
    const orderName = (r.order as any)?.order || '未知'
    impossibleItems.push({ label: `❌ ${orderName}`, reason: r.reason, suggestion: r.suggestion })
  }

  // ── 追加到日志 ──
  chatHistory.value.push({
    user: userText,
    msg: aiMessage.value,
    orders: orderItems,
    rejected: rejectedItems.length ? rejectedItems : undefined,
    difficult: difficultItems.length ? difficultItems : undefined,
    impossible: impossibleItems.length ? impossibleItems : undefined,
    validationSummary: worldValidation.value?.summary || undefined,
  })

  // 清空输入
  userMessage.value = ''

  // ── Phase 4：提交最终通过的指令 ──
  const finalOrders = getFinalApprovedOrders()
  if (finalOrders.length) {
    submit(finalOrders)
    await advance()
  }

  // 日志自动滚到底
  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
}
</script>

<style scoped>
.ai-dock {
  width: 100%;
  max-width: 860px;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  background: var(--paper-panel, #f3ead7);
  border: 1px solid var(--brown-line, #8a6d4b);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 10px rgba(90, 60, 20, 0.15);
  font-family: var(--font-kai, serif);
  overflow: hidden;
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-bottom: 1px dashed var(--brown-line-faint, rgba(138, 109, 75, 0.3));
  flex-shrink: 0;
}

.dock-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--ink-strong, #4a3a22);
}

.dock-collapse {
  border: none;
  background: transparent;
  color: var(--ink-muted, #9c8a6a);
  cursor: pointer;
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-sm);
}

.dock-collapse:hover {
  background: var(--paper-faint, #e8dcc0);
  color: var(--cinnabar, #b23a2e);
}

/* ===== 折叠过渡 ===== */
.dock-collapse-enter-active,
.dock-collapse-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.dock-collapse-enter-from,
.dock-collapse-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .dock-collapse-enter-active,
  .dock-collapse-leave-active {
    transition: opacity 0.2s ease !important;
  }
  .dock-collapse-enter-from,
  .dock-collapse-leave-to {
    transform: none !important;
  }
}

/* ===== body ===== */
.dock-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 14px 12px;
  height: 150px;
  overflow: hidden;
}

/* ===== 错误 ===== */
.dock-error {
  background: var(--danger-bg, #f7dede);
  border: 1px solid var(--danger-ink, #b23a2e);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  color: var(--danger-ink, #b23a2e);
  font-size: 13px;
  flex-shrink: 0;
}

/* ===== 左右主区域 ===== */
.dock-main {
  display: flex;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

/* ===== 左栏：输入 ===== */
.dock-left {
  flex: 6;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dock-input-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}

.dock-textarea {
  background: var(--paper-input, #fbf6ea);
  border: 1px solid var(--brown-line, #8a6d4b);
  border-radius: var(--radius-md);
  color: var(--ink, #3b2f1d);
  font-size: 13px;
  font-family: 'Consolas', 'Courier New', monospace;
  padding: 8px 110px 8px 10px;
  resize: none;
  outline: none;
  line-height: 1.5;
  box-sizing: border-box;
  display: block;
  width: 100%;
  height: 100%;
}

.dock-textarea:focus {
  border-color: var(--cinnabar, #b23a2e);
  background: var(--paper-hi, #fff);
}

.dock-btns {
  display: flex;
  flex-direction: row;
  gap: 6px;
  position: absolute;
  bottom: 6px;
  right: 6px;
}

.dock-status {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
  margin-top: auto;
}

.dock-queue {
  padding: 2px 8px;
  border: 1px solid var(--brown-line-faint, rgba(138, 109, 75, 0.3));
  border-radius: var(--radius-sm);
  background: var(--paper-faint, #e8dcc0);
  align-self: flex-start;
}

.dock-stopped {
  color: var(--danger-ink, #b23a2e);
}

/* ===== 右栏：操作日志 + 状态 ===== */
.dock-right-col {
  flex: 4;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dock-right {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dock-empty {
  color: var(--ink-muted, #9c8a6a);
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
  letter-spacing: 2px;
}

/* 每条日志 */
.log-entry {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* 玩家原文 */
.log-user {
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
  padding-left: 4px;
  letter-spacing: 1px;
}

/* AI msg 气泡 */
.log-msg {
  background: var(--paper-faint, #e8dcc0);
  border-left: 3px solid var(--cinnabar, #b23a2e);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  color: var(--ink, #3b2f1d);
  font-size: 13px;
  line-height: 1.5;
}

/* 指令摘要行 */
.log-orders {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  padding-left: 4px;
}

.log-dot {
  color: #2f9e44;
}

.log-dot.bad {
  color: var(--danger-ink, #b23a2e);
}

/* ── 世界AI校验状态 ── */
.log-validation-summary {
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
  padding-left: 4px;
  font-style: italic;
}

.log-validating {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
  padding: 4px 8px;
}

.log-validating-spin {
  display: inline-block;
  animation: log-spin 1.5s linear infinite;
}

@keyframes log-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── 被拒指令 ── */
.log-rejected {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.log-rejected-item {
  background: var(--danger-bg, #f7dede);
  border: 1px solid var(--danger-ink-faint, rgba(178, 58, 46, 0.3));
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-rejected-label {
  color: var(--danger-ink, #b23a2e);
  font-weight: 600;
}

.log-rejected-reason {
  color: var(--ink-muted, #9c8a6a);
}

/* ── 世界AI：困难指令（amber 警告） ── */
.log-difficult {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.log-difficult-item {
  background: #f0e4c8;
  border: 1px solid rgba(160, 120, 40, 0.4);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-difficult-label {
  color: #8a6020;
  font-weight: 600;
}

.log-difficult-reason {
  color: var(--ink-muted, #9c8a6a);
}

.log-difficult-suggestion {
  color: #8a6020;
  font-style: italic;
  padding-left: 4px;
  border-left: 2px solid rgba(160, 120, 40, 0.4);
}

/* ── 世界AI：不可能指令（朱砂拒绝） ── */
.log-impossible {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.log-impossible-item {
  background: var(--danger-bg, #f7dede);
  border: 1px solid var(--danger-ink-faint, rgba(178, 58, 46, 0.3));
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-impossible-label {
  color: var(--danger-ink, #b23a2e);
  font-weight: 600;
}

.log-impossible-reason {
  color: var(--ink-muted, #9c8a6a);
}

.log-impossible-suggestion {
  color: var(--cinnabar, #b23a2e);
  padding-left: 4px;
  border-left: 2px solid var(--danger-ink-faint, rgba(178, 58, 46, 0.3));
}

/* ===== 滚动条 ===== */
.dock-right::-webkit-scrollbar {
  width: 6px;
}
.dock-right::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
}
</style>
