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
        <div v-if="error || parseError" class="dock-error">{{ error || parseError }}</div>

        <div class="dock-main">
          <!-- 左栏：输入 -->
          <div class="dock-left">
            <textarea
              v-model="userMessage"
              class="dock-textarea"
              rows="3"
              placeholder="例如：派兵进攻杭州"
              @keydown.enter.exact.prevent="onSend"
            />
            <div class="dock-btns">
              <GameButton :disabled="loading" @click="onSend">
                <IconSend :size="16" />{{ loading ? '请求中' : '发送' }}
              </GameButton>
              <GameButton size="small" :disabled="!undoStack.length" @click="undo">
                <IconUndo :size="14" />撤销
              </GameButton>
            </div>
            <div class="dock-status">
              <span class="dock-queue">队列 {{ queue.length }} · {{ statusText }}</span>
              <span v-if="status === 'stopped'" class="dock-stopped">
                ⏸ 已在 {{ stoppedAt?.order }} 处停下
              </span>
            </div>
          </div>

          <!-- 右栏：操作日志 -->
          <div ref="logRef" class="dock-right">
            <div v-if="chatHistory.length === 0" class="dock-empty">暂无操作记录</div>
            <div
              v-for="(entry, i) in chatHistory"
              :key="i"
              class="log-entry"
            >
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
}

const {
  userMessage,
  loading,
  error,
  parsed,
  parseError,
  aiMessage,
  undoStack,
  runSend,
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

  await runSend()

  // 收集指令摘要（含校验结果）
  const orderItems: string[] = []
  if (parsed.value) {
    for (let i = 0; i < parsed.value.orders.length; i++) {
      const errs = parsed.value.errors[i]
      orderItems.push(errs.length ? `${parsed.value.orders[i].order} ✗` : `${parsed.value.orders[i].order} ✓`)
    }
  }

  // 追加到日志
  chatHistory.value.push({
    user: userText,
    msg: aiMessage.value,
    orders: orderItems,
  })

  // 清空输入
  userMessage.value = ''

  // 执行有效指令
  if (parsed.value) {
    const valid = parsed.value.orders.filter((_, i) => !parsed.value!.errors[i].length)
    if (valid.length) {
      submit(valid)
      await advance()
    }
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
  border-radius: 12px;
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
  border-radius: 4px;
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

/* ===== body ===== */
.dock-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 14px 12px;
  max-height: 300px;
  overflow: hidden;
}

/* ===== 错误 ===== */
.dock-error {
  background: var(--danger-bg, #f7dede);
  border: 1px solid var(--danger-ink, #b23a2e);
  border-radius: 6px;
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

.dock-textarea {
  background: var(--paper-input, #fbf6ea);
  border: 1px solid var(--brown-line, #8a6d4b);
  border-radius: 6px;
  color: var(--ink, #3b2f1d);
  font-size: 13px;
  font-family: 'Consolas', 'Courier New', monospace;
  padding: 8px 10px;
  resize: none;
  outline: none;
  line-height: 1.5;
  box-sizing: border-box;
}

.dock-textarea:focus {
  border-color: var(--cinnabar, #b23a2e);
  background: var(--paper-hi, #fff);
}

.dock-btns {
  display: flex;
  flex-direction: row;
  gap: 8px;
  justify-content: flex-end;
  margin-top: auto;
}

.dock-status {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
  margin-top: auto;
}

.dock-queue {
  padding: 2px 8px;
  border: 1px solid var(--brown-line-faint, rgba(138, 109, 75, 0.3));
  border-radius: 4px;
  background: var(--paper-faint, #e8dcc0);
  align-self: flex-start;
}

.dock-stopped {
  color: var(--danger-ink, #b23a2e);
}

/* ===== 右栏：操作日志 ===== */
.dock-right {
  flex: 4;
  min-width: 0;
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
  border-radius: 6px;
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

/* ===== 滚动条 ===== */
.dock-right::-webkit-scrollbar {
  width: 6px;
}
.dock-right::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: 3px;
}
</style>
