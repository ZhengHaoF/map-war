<template>
  <div class="event-log">
    <div v-if="events.length === 0" class="empty-state">
      <span class="empty-icon">📜</span>
      <span class="empty-text">暂无事件，等待游戏推演…</span>
    </div>

    <div v-else class="log-header">
      <span class="log-count">共 {{ events.length }} 条事件</span>
      <span class="log-latest">{{ latestDate }}</span>
    </div>

    <div ref="listRef" class="log-list">
      <div v-for="(e, i) in events" :key="i" class="log-row" :class="`row--${e.type}`">
        <span class="row-index">{{ i + 1 }}</span>
        <span class="row-badge">{{ eventBadge(e) }}</span>
        <span class="row-text">{{ describe(e) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useGameStore } from '@/stores/game'
import type { GameEvent } from '@/stores/game'
import { eventBadge, describeEvent } from '@/utils/eventDescribe'

const store = useGameStore()
const listRef = ref<HTMLElement | null>(null)

const events = computed(() => store.eventLog)

const latestDate = computed(() => {
  const tail = events.value.filter((e) => e.type === 'dateAdvance').pop()
  return tail ? tail.date : '—'
})

// 每次新事件自动滚到底部
watch(
  () => events.value.length,
  () => {
    nextTick(() => {
      if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
    })
  },
)

/** 事件 → 一行可读文本 */
function describe(e: GameEvent): string {
  return describeEvent(e, store.cities)
}
</script>

<style scoped>
.event-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 200px;
  max-height: 420px;
}

/* ── 空态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--ink);
  opacity: 0.5;
}
.empty-icon { font-size: 32px; }
.empty-text { font-size: 14px; }

/* ── 头部 ── */
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--ink);
  opacity: 0.2;
}
.log-count { font-size: 13px; color: var(--ink); opacity: 0.6; }
.log-latest { font-size: 12px; color: var(--ink); opacity: 0.45; }

/* ── 列表 ── */
.log-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
}

.log-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.5;
  transition: background 0.12s;
}
.log-row:hover {
  background: rgba(139, 90, 43, 0.06);
}

.row-index {
  flex-shrink: 0;
  width: 24px;
  text-align: right;
  font-size: 11px;
  color: var(--ink);
  opacity: 0.35;
}

.row-badge {
  flex-shrink: 0;
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  min-width: 28px;
  text-align: center;
}

/* 事件类型配色 */
.row--capture .row-badge   { background: var(--cinnabar); color: #fff; }
.row--attack .row-badge    { background: #b45309; color: #fff; }
.row--moraleChange .row-badge { background: #d4a017; color: #333; }
.row--produce .row-badge   { background: #2e6b8a; color: #fff; }
.row--dateAdvance .row-badge { background: #8b7a5a; color: #f5eedc; }
.row--setFactionAlive .row-badge { background: #6b4e8a; color: #eee; }
.row--battleStart .row-badge   { background: #c0392b; color: #fff; }
.row--battleEnd .row-badge     { background: #b0a08a; color: #4a3520; }
.row--selectFaction .row-badge { background: var(--cinnabar); color: #fff; }
.row--moveTroops .row-badge   { background: #4a7d9a; color: #fff; }
.row--narrative .row-badge    { background: #5a7a6a; color: #e8f0ea; }

/* 特殊行标记 */
.row--setFactionAlive .row-text { font-style: italic; }
.row--dateAdvance .row-text { opacity: 0.7; }
.row--narrative .row-text { font-style: italic; opacity: 0.8; }

.row-text {
  flex: 1;
  color: var(--ink);
  word-break: break-all;
}
</style>
