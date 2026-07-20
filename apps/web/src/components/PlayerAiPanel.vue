<template>
  <GameModal
    :visible="visible"
    title="玩家 AI 操作台"
    width="380px"
    variant="parchment"
    :z-index="2000"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="ai-chat-body">
      <Transition name="chat-collapse">
        <div class="chat-body">
          <!-- 错误提示 -->
          <div v-if="error || parseError" class="chat-error">{{ error || parseError }}</div>

          <!-- 消息区 -->
          <div ref="logRef" class="chat-messages">
            <div v-if="chatHistory.length === 0" class="chat-empty">输入指令开始推演…</div>

            <div v-for="(entry, i) in chatHistory" :key="i" class="chat-turn">
              <!-- 玩家消息（右对齐） -->
              <div class="chat-bubble chat-bubble--player">
                {{ entry.user }}
              </div>

              <!-- AI 回应组（左对齐） -->
              <div class="chat-ai-group">
                <!-- AI 叙事 -->
                <div v-if="entry.msg" class="chat-bubble chat-bubble--ai">
                  {{ entry.msg }}
                </div>

                <!-- 指令摘要 -->
                <div v-if="entry.orders.length" class="chat-orders">
                  <span
                    v-for="(o, j) in entry.orders"
                    :key="j"
                    class="chat-dot"
                    :class="{ bad: o.endsWith('✗') }"
                  >{{ o }}</span>
                </div>

                <!-- 校验摘要 -->
                <div v-if="entry.validationSummary" class="chat-verdict">
                  {{ entry.validationSummary }}
                </div>

                <!-- 硬编码规则拒绝 -->
                <div v-if="entry.rejected?.length" class="chat-rejected">
                  <div v-for="(r, k) in entry.rejected" :key="k" class="chat-rejected-item">
                    <span class="chat-rejected-label">✕ {{ r.label }}</span>
                    <span class="chat-rejected-reason">{{ r.reason }}</span>
                  </div>
                </div>

                <!-- 困难指令 -->
                <div v-if="entry.difficult?.length" class="chat-difficult">
                  <div v-for="(r, k) in entry.difficult" :key="k" class="chat-difficult-item">
                    <div class="chat-difficult-head">{{ r.label }}</div>
                    <div class="chat-difficult-reason">{{ r.reason }}</div>
                    <div v-if="r.suggestion" class="chat-difficult-suggestion">💡 {{ r.suggestion }}</div>
                  </div>
                </div>

                <!-- 不可能指令 -->
                <div v-if="entry.impossible?.length" class="chat-impossible">
                  <div v-for="(r, k) in entry.impossible" :key="k" class="chat-impossible-item">
                    <div class="chat-impossible-head">{{ r.label }}</div>
                    <div class="chat-impossible-reason">{{ r.reason }}</div>
                    <div v-if="r.suggestion" class="chat-impossible-suggestion">⇢ {{ r.suggestion }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 队列状态 -->
          <div class="chat-status">
            <span class="chat-queue">队列 {{ queue.length }} · {{ statusText }}</span>
            <span v-if="status === 'stopped'" class="chat-stopped">⏸ 已在 {{ stoppedAt?.order }} 处停下</span>
          </div>

          <!-- 输入区 -->
          <div class="chat-input-area">
            <textarea
              v-model="userMessage"
              class="chat-textarea"
              rows="2"
              placeholder="例如：派兵进攻杭州"
              @keydown.enter.exact.prevent="onSend"
            ></textarea>
            <div class="chat-input-btns">
              <GameButton parchment size="small" :disabled="!undoStack.length" @click="undo">
                <IconUndo :size="14" />撤销
              </GameButton>
              <GameButton parchment :disabled="loading" @click="onSend">
                <IconSend :size="16" />{{ loading ? '请求中' : '发送' }}
              </GameButton>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useAiDebug } from '@/composables/useAiDebug'
import { useGameScheduler } from '@/composables/useGameScheduler'
import GameButton from '@/components/ui/GameButton.vue'
import GameModal from '@/components/ui/GameModal.vue'
import IconSend from '~icons/tabler/send'
import IconUndo from '~icons/tabler/arrow-back-up'

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
  worldDifficult,
  worldImpossible,
  runSend,
  applyStrategicRules,
  getFinalApprovedOrders,
  undo,
} = useAiDebug('user')

const { queue, status, stoppedAt, submit, advance } = useGameScheduler()

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

// 监听顾问建议事件，填充到输入框
function handleAdvisorSuggestion(event: CustomEvent): void {
  const suggestion = event.detail?.suggestion
  if (suggestion) {
    userMessage.value = suggestion
  }
}

onMounted(() => {
  window.addEventListener('advisor-suggestion', handleAdvisorSuggestion as EventListener)
})

onUnmounted(() => {
  window.removeEventListener('advisor-suggestion', handleAdvisorSuggestion as EventListener)
})

const chatHistory = ref<ChatEntry[]>([])
const logRef = ref<HTMLElement | null>(null)

interface ChatEntry {
  user: string
  msg: string | null
  orders: string[]
  rejected?: { label: string; reason: string }[]
  difficult?: { label: string; reason: string; suggestion?: string }[]
  impossible?: { label: string; reason: string; suggestion?: string }[]
  validationSummary?: string
}

const statusText = computed(() => {
  switch (status.value) {
    case 'running': return '推进中…'
    case 'done': return '已跑完'
    case 'stopped': return '已停下'
    default: return '空闲'
  }
})

async function onSend(): Promise<void> {
  const userText = userMessage.value.trim()
  if (!userText) return

  await runSend()

  const orderItems: string[] = []
  if (parsed.value) {
    for (let i = 0; i < parsed.value.orders.length; i++) {
      const errs = parsed.value.errors[i]
      orderItems.push(errs.length ? `${parsed.value.orders[i].order} ✗` : `${parsed.value.orders[i].order} ✓`)
    }
  }

  applyStrategicRules()

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

  // narrative 落库已收敛到编排层（useAiDebug.runSend），此处只负责 UI 渲染，不再写 eventLog。
  chatHistory.value.push({
    user: userText,
    msg: aiMessage.value,
    orders: orderItems,
    rejected: rejectedItems.length ? rejectedItems : undefined,
    difficult: difficultItems.length ? difficultItems : undefined,
    impossible: impossibleItems.length ? impossibleItems : undefined,
    validationSummary: worldValidation.value?.summary || undefined,
  })

  userMessage.value = ''

  const finalOrders = getFinalApprovedOrders()
  if (finalOrders.length) {
    submit(finalOrders)
    await advance()
  }

  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
}
</script>

<style scoped>
/* ===== 弹窗内容容器 ===== */
.ai-chat-body {
  display: flex;
  flex-direction: column;
  max-height: 72vh;
  min-height: 0;
  overflow: hidden;
}

/* ===== 折叠过渡 ===== */
.chat-collapse-enter-active,
.chat-collapse-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.chat-collapse-enter-from,
.chat-collapse-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-reduced-motion: reduce) {
  .chat-collapse-enter-active,
  .chat-collapse-leave-active {
    transition: opacity 0.2s ease !important;
  }
  .chat-collapse-enter-from,
  .chat-collapse-leave-to {
    transform: none !important;
  }
}

/* ===== body ===== */
.chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 8px 12px;
  gap: 8px;
}

/* ===== 错误 ===== */
.chat-error {
  background: var(--danger-bg, #f7dede);
  border: 1px solid var(--danger-ink, #b23a2e);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  color: var(--danger-ink, #b23a2e);
  font-size: 13px;
  flex-shrink: 0;
}

/* ===== 消息滚动区 ===== */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-empty {
  color: var(--ink-muted, #9c8a6a);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
  letter-spacing: 2px;
}

/* ===== 对话轮回 ===== */
.chat-turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ===== 聊天气泡 ===== */
.chat-bubble {
  max-width: 92%;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  font-size: 16px;
  line-height: 1.55;
  word-break: break-word;
}

.chat-bubble--player {
  align-self: flex-end;
  background: var(--paper-dark, #d6c3a0);
  color: var(--ink-strong, #2c1a0a);
  border: 1px solid var(--brown-line, #b8a07a);
  border-bottom-right-radius: 4px;
}

.chat-bubble--ai {
  align-self: flex-start;
  background: var(--paper-faint, #e8dcc0);
  color: var(--ink, #3b2f1d);
  border-left: 3px solid var(--cinnabar, #b04a3a);
  border-top-left-radius: 4px;
}

/* ===== AI 回应组（左对齐，指令 + 校验在气泡下方） ===== */
.chat-ai-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 4px;
}

/* ===== 指令摘要 ===== */
.chat-orders {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 14px;
  padding: 0 4px;
}

.chat-dot {
  color: #2f9e44;
}

.chat-dot.bad {
  color: var(--danger-ink, #b23a2e);
}

/* ===== 校验摘要 ===== */
.chat-verdict {
  font-size: 13px;
  color: var(--ink-muted, #9c8a6a);
  font-style: italic;
  padding: 0 4px;
}

/* ===== 硬编码拒绝 ===== */
.chat-rejected {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-rejected-item {
  background: var(--danger-bg, #f7dede);
  border: 1px solid rgba(178, 58, 46, 0.3);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 96%;
}

.chat-rejected-label {
  color: var(--danger-ink, #b23a2e);
  font-weight: 600;
}

.chat-rejected-reason {
  color: var(--ink-muted, #9c8a6a);
}

/* ===== 困难指令 ===== */
.chat-difficult {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-difficult-item {
  background: #f0e4c8;
  border: 1px solid rgba(160, 120, 40, 0.4);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 96%;
}

.chat-difficult-head {
  color: #8a6020;
  font-weight: 600;
}

.chat-difficult-reason {
  color: var(--ink-muted, #9c8a6a);
}

.chat-difficult-suggestion {
  color: #8a6020;
  font-style: italic;
  padding-left: 4px;
  border-left: 2px solid rgba(160, 120, 40, 0.4);
}

/* ===== 不可能指令 ===== */
.chat-impossible {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-impossible-item {
  background: var(--danger-bg, #f7dede);
  border: 1px solid rgba(178, 58, 46, 0.3);
  border-radius: var(--radius-sm);
  padding: 5px 10px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 96%;
}

.chat-impossible-head {
  color: var(--danger-ink, #b23a2e);
  font-weight: 600;
}

.chat-impossible-reason {
  color: var(--ink-muted, #9c8a6a);
}

.chat-impossible-suggestion {
  color: var(--cinnabar, #b23a2e);
  padding-left: 4px;
  border-left: 2px solid rgba(178, 58, 46, 0.3);
}

/* ===== 队列状态 ===== */
.chat-status {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
}

.chat-queue {
  padding: 2px 8px;
  border: 1px solid rgba(138, 109, 75, 0.3);
  border-radius: var(--radius-sm);
  background: var(--paper-faint, #e8dcc0);
  align-self: flex-start;
}

.chat-stopped {
  color: var(--danger-ink, #b23a2e);
}

/* ===== 输入区 ===== */
.chat-input-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.chat-textarea {
  background: var(--paper-input, #fbf6ea);
  border: 1px solid var(--brown-line, #8a6d4b);
  border-radius: var(--radius-md);
  color: var(--ink, #3b2f1d);
  font-size: 15px;
  font-family: inherit;
  padding: 8px 10px;
  resize: none;
  outline: none;
  line-height: 1.5;
  box-sizing: border-box;
  width: 100%;
}

.chat-textarea:focus {
  border-color: var(--cinnabar, #b23a2e);
  background: var(--paper-hi, #fff);
}

.chat-input-btns {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* ===== 滚动条 ===== */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
}
</style>
