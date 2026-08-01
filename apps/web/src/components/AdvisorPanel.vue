<template>
  <GameModal
    :visible="visible"
    title="战略顾问"
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
            <div v-if="chatHistory.length === 0 && !busy" class="chat-empty">输入问题咨询顾问…</div>

            <div v-for="(entry, i) in chatHistory" :key="i" class="chat-turn">
              <!-- 玩家消息（右对齐） -->
              <div class="chat-bubble chat-bubble--player">
                {{ entry.user }}
              </div>

              <!-- 顾问回应组（左对齐） -->
              <div class="chat-ai-group">
                <!-- 顾问回复 -->
                <div v-if="entry.reply" class="chat-bubble chat-bubble--ai">
                  {{ entry.reply }}
                </div>

                <!-- 等待顾问回应的占位（最后一轮 + busy 中） -->
                <div
                  v-else-if="i === chatHistory.length - 1 && busy"
                  class="chat-typing"
                >
                  <span class="chat-typing-dot"></span>
                  <span class="chat-typing-dot"></span>
                  <span class="chat-typing-dot"></span>
                </div>

                <!-- 指挥建议列表 -->
                <div v-if="entry.suggestions?.length" class="chat-suggestions">
                  <div class="chat-suggestions-header">💡 可执行指令：</div>
                  <div
                    v-for="(suggestion, j) in entry.suggestions"
                    :key="j"
                    class="chat-suggestion-item"
                    @click="sendToCommand(suggestion)"
                  >
                    <span class="chat-suggestion-text">{{ suggestion }}</span>
                    <span class="chat-suggestion-copy">发送指挥</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 输入区 -->
          <div class="chat-input-area">
            <textarea
              v-model="userMessage"
              class="chat-textarea"
              rows="2"
              :placeholder="busy ? '分析中，请稍候…' : '例如：攻打杭州可行吗？'"
              :disabled="busy"
              @keydown.enter.exact.prevent="onSend"
            ></textarea>
            <div class="chat-input-btns">
              <GameButton parchment :disabled="busy" @click="onSend">
                <IconSend :size="16" />{{ busy ? '分析中' : '咨询' }}
              </GameButton>
            </div>
          </div>

          <!-- 进队栏：面板底部，展示当前顾问决策进度 -->
          <WorldProgressBanner
            :loading="busy"
            mainText="战略顾问 · 决策中…"
            subText="AI 顾问 推演中"
            sealChar="策"
          />
        </div>
      </Transition>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useAiOrchestrator } from '@/composables/useAiOrchestrator'
import GameButton from '@/components/ui/GameButton.vue'
import GameModal from '@/components/ui/GameModal.vue'
import WorldProgressBanner from '@/components/WorldProgressBanner.vue'
import IconSend from '~icons/tabler/send'

const {
  userMessage,
  loading,
  error,
  parseError,
  aiMessage,
  advisorResponse,
  runSend,
} = useAiOrchestrator('advisor')

const busy = computed(() => loading.value)

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const chatHistory = ref<ChatEntry[]>([])
const logRef = ref<HTMLElement | null>(null)

interface ChatEntry {
  user: string
  reply: string | null
  suggestions?: string[]
}

async function onSend(): Promise<void> {
  if (busy.value) return
  const userText = userMessage.value.trim()
  if (!userText) return

  await runSend()

  // 从 advisorResponse 提取顾问回复和建议
  const reply = aiMessage.value
  const suggestions = advisorResponse.value?.suggestions || []

  chatHistory.value.push({
    user: userText,
    reply,
    suggestions: suggestions.length ? suggestions : undefined,
  })

  userMessage.value = ''

  await nextTick()
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
}

function sendToCommand(suggestion: string): void {
  // 触发自定义事件，让军师面板监听并填充
  window.dispatchEvent(new CustomEvent('advisor-suggestion', { detail: { suggestion } }))
  // 打开指挥面板
  window.dispatchEvent(new CustomEvent('open-command-panel'))
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

/* ===== 顾问决策中（与 WorldProgressBanner 风格一致） ===== */
.chat-thinking {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: linear-gradient(to bottom, var(--paper-input, #fbf6ea), var(--paper-darker, #e8dcc0));
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-md);
  box-shadow: 0 2px 6px rgba(60, 40, 15, 0.1);
  font-family: var(--font-kai);
  color: var(--ink, #3b2f1d);
}
.chat-thinking-seal {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--cinnabar, #b04a3a);
  color: var(--cinnabar-ink, #fbeee6);
  font-size: 14px;
  font-weight: 600;
}
.chat-thinking-text {
  flex: 1;
  min-width: 0;
}
.chat-thinking-main {
  font-size: 14px;
  letter-spacing: 1px;
}
.chat-thinking-sub {
  font-size: 11px;
  color: var(--ink-soft, #8a6d4b);
  margin-top: 1px;
}
.chat-thinking-track {
  position: relative;
  width: 56px;
  height: 3px;
  border-radius: 2px;
  background: rgba(138, 109, 75, 0.25);
  overflow: hidden;
  flex-shrink: 0;
}
.chat-thinking-edge {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 40%;
  border-radius: 2px;
  background: var(--cinnabar, #b04a3a);
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

/* ===== 等待回应的打字占位 ===== */
.chat-typing {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;
  background: var(--paper-faint, #e8dcc0);
  color: var(--ink-soft, #8a6d4b);
  border-left: 3px solid var(--cinnabar, #b04a3a);
  border-top-left-radius: 4px;
  border-radius: var(--radius-md);
  max-width: 60px;
}
.chat-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-soft, #8a6d4b);
  animation: typingBounce 1.2s ease-in-out infinite;
}
.chat-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.chat-typing-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes typingBounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
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

/* ===== AI 回应组（左对齐） ===== */
.chat-ai-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-left: 4px;
}

/* ===== 建议列表 ===== */
.chat-suggestions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.chat-suggestions-header {
  font-size: 13px;
  color: var(--ink-muted, #9c8a6a);
  font-weight: 600;
}

.chat-suggestion-item {
  background: var(--paper-faint, #e8dcc0);
  border: 1px solid var(--brown-line, #b8a07a);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-suggestion-item:hover {
  background: var(--paper-dark, #d6c3a0);
  border-color: var(--cinnabar, #b04a3a);
}

.chat-suggestion-text {
  flex: 1;
  color: var(--ink, #3b2f1d);
}

.chat-suggestion-copy {
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
  margin-left: 8px;
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

.chat-textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--paper-faint, #e8dcc0);
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