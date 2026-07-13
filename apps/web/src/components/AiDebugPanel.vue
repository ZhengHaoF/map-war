<template>
  <div class="ai-debug">
    <!-- 工具栏：上下文注入 / 动画 / 撤销 / 重置 -->
    <div class="ai-toolbar">
      <label class="ai-toggle">
        <input type="checkbox" v-model="injectContext" />
        注入世界态
      </label>
      <label class="ai-toggle">
        <input type="checkbox" v-model="cinematic" />
        播放动画
      </label>
      <GameButton size="small" :disabled="!undoStack.length" @click="undo">
        <component :is="ICONS.undo" :size="14" />撤销
      </GameButton>
      <GameButton size="small" danger @click="resetWorld">
        <component :is="ICONS.reset" :size="14" />重置世界
      </GameButton>
      <GameButton size="small" @click="debugSearch">
        <component :is="ICONS.search" :size="14" />搜索咸阳
      </GameButton>
    </div>

    <pre v-if="searchLog" class="ai-pre ai-raw">{{ searchLog }}</pre>

    <div class="ai-field">
      <label class="ai-label">System Prompt（自动生成，可改）</label>
      <textarea v-model="systemPrompt" class="ai-textarea" rows="3" />
    </div>

    <div class="ai-field">
      <label class="ai-label">User Message（给 god-mode AI 的自然语言指令）</label>
      <textarea
        v-model="userMessage"
        class="ai-textarea"
        rows="4"
        placeholder="例如：占领北平给 KMT，并把日期推进到 1937-07-07"
      />
    </div>

    <div class="ai-actions">
      <GameButton :active="loading" :disabled="loading" @click="runSend">
        <component :is="ICONS.send" :size="16" />
        {{ loading ? '请求中...' : '发送' }}
      </GameButton>
      <GameButton :disabled="!parsed || loading" @click="runExecute">
        <component :is="ICONS.play" :size="16" />执行校验通过的指令
      </GameButton>
    </div>

    <div v-if="error" class="ai-error">{{ error }}</div>
    <div v-if="parseError" class="ai-error">{{ parseError }}</div>

    <!-- 解析 + 校验结果 -->
    <div v-if="parsed" class="ai-section">
      <div class="ai-section-title">
        解析结果：{{ parsed.orders.length }} 条，校验{{ parsed.allOk ? '全部通过 ✓' : '有错误 ✗' }}
      </div>
      <div
        v-for="(o, i) in parsed.orders"
        :key="i"
        class="ai-order"
        :class="{ bad: parsed.errors[i].length }"
      >
        <pre class="ai-pre">{{ JSON.stringify(o, null, 2) }}</pre>
        <div v-if="parsed.errors[i].length" class="ai-errlist">
          <div v-for="(e, j) in parsed.errors[i]" :key="j" class="ai-err">✗ {{ e }}</div>
        </div>
        <div v-else class="ai-ok">✓ 结构校验通过</div>
      </div>
    </div>

    <!-- 执行结果 -->
    <div v-if="execResults.length" class="ai-section">
      <div class="ai-section-title">执行结果</div>
      <div
        v-for="(r, i) in execResults"
        :key="i"
        class="ai-exec"
        :class="{ bad: !r.valid || !r.result?.ok }"
      >
        <div class="ai-exec-head">
          <span class="ai-badge">{{ r.order.order }}</span>
          <span
            :class="r.valid ? (r.result?.ok ? 'ai-ok' : 'ai-err') : 'ai-err'"
          >
            {{
              r.valid
                ? r.result?.ok
                  ? '执行成功'
                  : '执行失败：' + (r.result?.reason ?? '未知')
                : '未执行（校验错）'
            }}
          </span>
        </div>
        <div v-if="r.detail" class="ai-detail">{{ r.detail }}</div>
      </div>
    </div>

    <!-- 原始响应（可折叠） -->
    <div v-if="response" class="ai-card" :class="{ open: cards.raw }" @click="cards.raw = !cards.raw">
      <span class="ai-card-title">原始响应</span>
      <component :is="cards.raw ? ICONS.chevronUp : ICONS.chevronDown" :size="16" class="ai-card-icon" />
    </div>
    <pre v-if="cards.raw && response" class="ai-pre ai-raw">{{ rawJson }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useAiDebug } from '@/composables/useAiDebug'
import GameButton from '@/components/ui/GameButton.vue'
import { resolveLocationId, searchLocationNames } from '@/utils/locationResolver'
import type { Component } from 'vue'
import IconSend from '~icons/tabler/send'
import IconPlay from '~icons/tabler/player-play'
import IconUndo from '~icons/tabler/arrow-back-up'
import IconReset from '~icons/tabler/reload'
import IconSearch from '~icons/tabler/search'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconChevronUp from '~icons/tabler/chevron-up'

const ICONS: Record<string, Component> = {
  send: IconSend,
  play: IconPlay,
  undo: IconUndo,
  reset: IconReset,
  search: IconSearch,
  chevronDown: IconChevronDown,
  chevronUp: IconChevronUp,
}

const {
  systemPrompt,
  userMessage,
  injectContext,
  cinematic,
  loading,
  error,
  response,
  parsed,
  parseError,
  execResults,
  undoStack,
  runSend,
  runExecute,
  undo,
  resetWorld,
} = useAiDebug()

const cards = reactive({ raw: false })

/** 调试：排查地点解析失败（如 AI 传短名而注册名带行政后缀）。 */
const searchLog = ref('')
function debugSearch(): void {
  const lines: string[] = []
  for (const t of ['咸阳', '重庆']) {
    const id = resolveLocationId(t)
    const matches = searchLocationNames(t)
    lines.push(`[搜索] "${t}"`)
    lines.push(`  resolveLocationId => ${id ?? 'null'}`)
    lines.push(
      `  注册名含"${t}"的: ${matches.length ? matches.map((m) => `${m.name}(${m.id})`).join('，') : '（无）'}`,
    )
  }
  searchLog.value = lines.join('\n')
  console.log('[调试] 地点解析排查\n' + searchLog.value)
}

const rawJson = computed(() => (response.value ? JSON.stringify(response.value, null, 2) : ''))
</script>

<style scoped>
.ai-debug {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px;
  max-height: 70vh;
  overflow: auto;
}

.ai-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--brown-line-faint);
}

.ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
  user-select: none;
}

.ai-toggle input {
  accent-color: var(--cinnabar);
}

.ai-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-label {
  font-size: 12px;
  color: var(--ink-muted);
  font-weight: 500;
}

.ai-textarea {
  width: 100%;
  background: var(--paper-input);
  border: 1px solid var(--brown-line);
  border-radius: 6px;
  color: var(--ink);
  font-size: 13px;
  font-family: 'Consolas', 'Courier New', monospace;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  line-height: 1.6;
  box-sizing: border-box;
}

.ai-textarea:focus {
  border-color: var(--cinnabar);
  background: var(--paper-hi);
}

.ai-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-error {
  background: var(--danger-bg);
  border: 1px solid var(--danger-ink);
  border-radius: 6px;
  padding: 10px 14px;
  color: var(--danger-ink);
  font-size: 13px;
}

.ai-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  border-left: 3px solid var(--cinnabar);
  padding-left: 8px;
}

.ai-order,
.ai-exec {
  background: var(--paper-faint);
  border: 1px solid var(--brown-line-faint);
  border-radius: 6px;
  padding: 10px;
}

.ai-order.bad,
.ai-exec.bad {
  border-color: var(--danger-ink);
  background: var(--danger-bg);
}

.ai-pre {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12px;
  font-family: 'Consolas', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}

.ai-errlist {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-err {
  color: var(--danger-ink);
  font-size: 12px;
}

.ai-ok {
  color: #2f9e44;
  font-size: 12px;
  margin-top: 4px;
}

.ai-exec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.ai-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: var(--cinnabar);
  background: var(--paper-input);
  border-radius: 4px;
  padding: 2px 8px;
}

.ai-detail {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-muted);
}

.ai-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--paper-faint);
  border: 1px solid var(--brown-line-faint);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.ai-card.open {
  border-color: var(--cinnabar);
}

.ai-card-title {
  font-size: 13px;
  color: var(--ink-soft);
  font-weight: 500;
}

.ai-card-icon {
  color: var(--ink-muted);
}

.ai-raw {
  background: var(--paper-dark);
  border-radius: 6px;
  padding: 12px;
  max-height: 240px;
  overflow: auto;
}
</style>
