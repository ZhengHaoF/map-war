<template>
  <div class="ai-debug">
    <div class="ai-field">
      <label class="ai-label">System Prompt</label>
      <textarea
        v-model="systemPrompt"
        class="ai-textarea"
        rows="4"
        placeholder="输入 system prompt..."
      />
    </div>

    <div class="ai-field">
      <label class="ai-label">User Message</label>
      <textarea
        v-model="userMessage"
        class="ai-textarea"
        rows="6"
        placeholder="输入 user message 或 JSON..."
      />
    </div>

    <div class="ai-actions">
      <GameButton :active="loading" :disabled="loading" @click="handleSend">
        <component :is="ICONS.send" :size="16" />
        {{ loading ? '请求中...' : '发送' }}
      </GameButton>
    </div>

    <div v-if="error" class="ai-error">{{ error }}</div>

    <div v-if="respData" class="ai-response">
      <div class="ai-card" :class="{ open: cards.raw }" @click="cards.raw = !cards.raw">
        <span class="ai-card-title">原始响应</span>
        <component
          :is="cards.raw ? ICONS.chevronUp : ICONS.chevronDown"
          :size="16"
          class="ai-card-icon"
        />
      </div>
      <pre v-if="cards.raw" class="ai-pre ai-raw">{{ respData.rawJson }}</pre>

      <div
        v-if="respData.toolCalls.length"
        class="ai-card"
        :class="{ open: cards.tools }"
        @click="cards.tools = !cards.tools"
      >
        <span class="ai-card-title">Tool Calls ({{ respData.toolCalls.length }})</span>
        <component
          :is="cards.tools ? ICONS.chevronUp : ICONS.chevronDown"
          :size="16"
          class="ai-card-icon"
        />
      </div>
      <div v-if="cards.tools && respData.toolCalls.length" class="ai-card-body">
        <div v-for="(tc, i) in respData.toolCalls" :key="i" class="ai-toolcall">
          <span class="ai-toolcall-name">{{ tc.name }}</span>
          <pre class="ai-pre">{{ tc.args }}</pre>
        </div>
      </div>

      <div class="ai-tokens">
        请求 {{ respData.usage.prompt }} tokens / 响应 {{ respData.usage.completion }} tokens / 总计
        {{ respData.usage.total }}
      </div>

      <div class="ai-card" :class="{ open: cards.text }" @click="cards.text = !cards.text">
        <span class="ai-card-title">文本回复</span>
        <component
          :is="cards.text ? ICONS.chevronUp : ICONS.chevronDown"
          :size="16"
          class="ai-card-icon"
        />
      </div>
      <div v-if="cards.text" class="ai-card-body">
        <pre class="ai-pre">{{ respData.content || '(无文本输出)' }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useAiChat } from '@/composables/useAiChat'
import GameButton from '@/components/ui/GameButton.vue'
import type { Component } from 'vue'
import IconSend from '~icons/tabler/send'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconChevronUp from '~icons/tabler/chevron-up'

const ICONS: Record<string, Component> = {
  send: IconSend,
  chevronDown: IconChevronDown,
  chevronUp: IconChevronUp,
}

const { loading, error, response, send } = useAiChat()

const systemPrompt = ref('')
const userMessage = ref('')

const cards = reactive({
  text: true,
  tools: false,
  raw: false,
})

interface ToolCallDisplay {
  name: string
  args: string
}

const respData = computed(() => {
  const raw = response.value as Record<string, unknown> | null
  if (!raw) return null

  const choice = ((raw.choices as unknown[]) ?? [])[0] as Record<string, unknown> | undefined
  const message = choice?.message as Record<string, unknown> | undefined
  const content = (message?.content as string) ?? ''
  const rawToolCalls = (message?.tool_calls as Array<Record<string, unknown>>) ?? []
  const toolCalls: ToolCallDisplay[] = rawToolCalls.map((tc) => ({
    name: (tc.function as Record<string, string>)?.name ?? 'unknown',
    args: JSON.stringify((tc.function as Record<string, unknown>)?.arguments ?? {}, null, 2),
  }))

  const usage = raw.usage as Record<string, number> | undefined
  return {
    content,
    toolCalls,
    usage: {
      prompt: usage?.prompt_tokens ?? 0,
      completion: usage?.completion_tokens ?? 0,
      total: usage?.total_tokens ?? 0,
    },
    rawJson: JSON.stringify(raw, null, 2),
  }
})

async function handleSend() {
  if (!userMessage.value.trim()) return

  const messages = []
  if (systemPrompt.value.trim()) {
    messages.push({ role: 'system', content: systemPrompt.value })
  }
  messages.push({ role: 'user', content: userMessage.value })

  await send({ messages })
}
</script>

<style scoped>
.ai-debug {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-label {
  font-size: 12px;
  color: #999;
  font-weight: 500;
}

.ai-textarea {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #ddd;
  font-size: 13px;
  font-family: 'Consolas', 'Courier New', monospace;
  padding: 8px 10px;
  resize: vertical;
  outline: none;
  line-height: 1.5;
  box-sizing: border-box;
}

.ai-textarea:focus {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(255, 255, 255, 0.08);
}

.ai-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-error {
  background: rgba(244, 68, 68, 0.15);
  border: 1px solid rgba(244, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  color: #f88;
  font-size: 13px;
}

.ai-response {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.ai-card:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ai-card.open {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.06);
}

.ai-card-title {
  font-size: 13px;
  color: #ccc;
  font-weight: 500;
}

.ai-card-icon {
  color: #888;
  flex-shrink: 0;
}

.ai-card-body {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 10px;
  max-height: 300px;
  overflow: auto;
}

.ai-pre {
  margin: 0;
  color: #bbb;
  font-size: 12px;
  font-family: 'Consolas', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}

.ai-raw {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 10px;
  max-height: 240px;
  overflow: auto;
}

.ai-toolcall {
  margin-bottom: 8px;
}

.ai-toolcall:last-child {
  margin-bottom: 0;
}

.ai-toolcall-name {
  display: inline-block;
  font-size: 12px;
  font-weight: 500;
  color: #7eb8ff;
  background: rgba(59, 130, 246, 0.15);
  border-radius: 4px;
  padding: 2px 8px;
  margin-bottom: 4px;
}

.ai-tokens {
  font-size: 12px;
  color: #777;
  text-align: right;
}
</style>
