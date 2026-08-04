<template>
  <GameModal
    :visible="visible"
    title="本回合大事记"
    variant="parchment"
    :closable="false"
    width="440px"
    @close="$emit('close')"
  >
    <div class="tsm-body">
      <!-- 滚动区：事件多时只滚这里，底栏固定不动 -->
      <div class="tsm-scroll">
        <!-- 空态保护 -->
        <div v-if="groups.length === 0" class="tsm-empty">
          无事发生，岁月静好。
        </div>

        <!-- 事件分组 -->
        <div v-for="g in groups" :key="g.key" class="tsm-group">
          <h3 class="tsm-group-title">
            <span class="tsm-group-label">{{ g.key }}</span>
            <span class="tsm-group-count">{{ g.events.length }}</span>
          </h3>
          <div
            v-for="(e, i) in g.events"
            :key="i"
            class="tsm-row"
            :class="{ 'tsm-row--important': isImportantEvent(e) }"
          >
            <span class="tsm-row-badge">{{ eventBadge(e) }}</span>
            <span class="tsm-row-text">{{ eventText(e) }}</span>
          </div>
        </div>
      </div>

      <!-- 底栏：固定在弹窗底部，不随内容滚动 -->
      <div class="tsm-footer">
        <GameButton parchment @click="onConfirm">
          <component :is="ICONS.check" :size="14" />知道了
        </GameButton>
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useGameStore, type GameEvent } from '@/stores/game'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
import {
  eventBadge,
  describeEvent,
  isImportantEvent,
  eventSummaryGroup,
  SUMMARY_GROUP_ORDER,
  type SummaryGroup,
} from '@/utils/eventDescribe'
import IconCheck from '~icons/tabler/check'

const props = defineProps<{
  visible: boolean
  events: GameEvent[]
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useGameStore()

const ICONS: Record<string, Component> = {
  check: IconCheck,
}

// ─── 分组 ───

/** 非例行事件（过滤掉叙事/日期推进） */
const meaningful = computed(() =>
  props.events.filter((e) => e.type !== 'narrative' && e.type !== 'dateAdvance'),
)

/** 按 SummaryGroup 分组 */
const groups = computed(() => {
  const map = new Map<SummaryGroup, GameEvent[]>()
  for (const e of meaningful.value) {
    const g = eventSummaryGroup(e)
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(e)
  }
  return SUMMARY_GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({
    key: k,
    events: map.get(k)!,
  }))
})

// ─── 事件文本 ───

function eventText(e: GameEvent): string {
  return describeEvent(e, store.cities)
}

// ─── 确认 ───

function onConfirm(): void {
  emit('close')
}
</script>

<style scoped>
/* ── 整体布局：滚动区 + 固定底栏 ── */
.tsm-body {
  display: flex;
  flex-direction: column;
  max-height: 55vh;
  color: var(--ink);
  font-size: 14px;
}

.tsm-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tsm-empty {
  text-align: center;
  color: var(--ink);
  opacity: 0.5;
  font-style: italic;
  padding: 24px 0;
}

/* ── 分组 ── */
.tsm-group-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-family: var(--font-song);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-panel);
  border-bottom: 1px solid rgba(90, 70, 40, 0.2);
  padding-bottom: 4px;
  margin-bottom: 4px;
  letter-spacing: 2px;
}

.tsm-group-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink);
  opacity: 0.4;
}

/* ── 事件行 ── */
.tsm-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.6;
}

.tsm-row:hover {
  background: rgba(139, 90, 43, 0.06);
}

.tsm-row--important {
  background: rgba(200, 80, 40, 0.06);
}

.tsm-row--important:hover {
  background: rgba(200, 80, 40, 0.1);
}

.tsm-row-badge {
  flex-shrink: 0;
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  min-width: 28px;
  text-align: center;
  background: rgba(90, 70, 40, 0.15);
  color: var(--ink);
}

.tsm-row--important .tsm-row-badge {
  background: var(--cinnabar);
  color: #fff;
}

.tsm-row-text {
  flex: 1;
  color: var(--ink);
  word-break: break-all;
}

.tsm-row--important .tsm-row-text {
  font-weight: 600;
}

/* ── 底栏：固定在弹窗底部 ── */
.tsm-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  border-top: 1px solid rgba(90, 70, 40, 0.2);
  padding: 12px 20px 16px;
  background: var(--paper-deep);
}
</style>
