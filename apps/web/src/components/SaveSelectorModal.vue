<template>
  <GameModal
    :visible="visible"
    title="载入战局"
    width="620px"
    :z-index="10001"
    :closable="false"
    variant="parchment"
  >
    <div class="selector">
      <div class="scroll-edges">
        <span class="edge top" />
        <span class="edge right" />
        <span class="edge bottom" />
        <span class="edge left" />
      </div>

      <div class="sel-head">
        <span class="head-line" />
        <span class="sel-title">存档卷宗</span>
        <span class="head-line" />
      </div>
      <p class="sel-sub">择一存档，续写山河</p>

      <div v-if="saves.length" class="save-list">
        <div v-for="s in saves" :key="s.slot" class="save-card">
          <div class="card-main">
            <div class="card-top">
              <span class="card-label">{{ s.label }}</span>
              <span v-if="s.slot === AUTO_SLOT" class="card-badge">自动存档</span>
            </div>
            <div class="card-meta">
              <span class="meta-item"><span class="meta-key">将领</span>{{ s.playerName || '—' }}</span>
              <span class="meta-item"><span class="meta-key">时局</span>{{ s.currentDate }}</span>
              <span class="meta-item"><span class="meta-key">推演</span>{{ s.eventCount }} 事</span>
            </div>
            <div class="card-time">{{ formatTime(s.savedAt) }}</div>
          </div>
          <div class="card-actions">
            <button class="act-btn load" @click="$emit('load', s.slot)">读取</button>
            <template v-if="confirmSlot === s.slot">
              <button class="act-btn confirm" @click="doDelete(s.slot)">确认删除</button>
              <button class="act-btn cancel" @click="confirmSlot = null">取消</button>
            </template>
            <button v-else class="act-btn del" @click="confirmSlot = s.slot">删除</button>
          </div>
        </div>
      </div>

      <div v-else class="empty">
        <span class="empty-seal">档</span>
        <p>尚无存档，请另起新局</p>
      </div>

      <button class="new-btn" @click="$emit('new-game')">
        <span class="btn-text">另起新局</span>
      </button>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import GameModal from '@/components/ui/GameModal.vue'
import { useSaveGame } from '@/composables/useSaveGame'
import type { SaveMeta } from '@/stores/game'

const props = defineProps<{
  visible?: boolean
}>()

defineEmits<{
  load: [slot: string]
  'new-game': []
}>()

const AUTO_SLOT = 'auto'
const { listGames, deleteGame } = useSaveGame()

const saves = ref<SaveMeta[]>([])
const confirmSlot = ref<string | null>(null)

function refresh(): void {
  saves.value = listGames()
}

function doDelete(slot: string): void {
  deleteGame(slot)
  confirmSlot.value = null
  refresh()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 每次弹窗打开时刷新列表（并清掉遗留的删除确认态）
watch(
  () => props.visible,
  (v) => {
    if (v) {
      confirmSlot.value = null
      refresh()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.selector {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 38px 40px 32px;
  background:
    radial-gradient(circle at 18% 22%, rgba(160, 110, 50, 0.06) 0%, transparent 45%),
    radial-gradient(circle at 82% 78%, rgba(140, 90, 40, 0.05) 0%, transparent 40%),
    var(--paper);
  color: var(--ink);
  min-height: 360px;
}

/* 仿古卷轴边线 */
.scroll-edges {
  position: absolute;
  inset: 12px;
  pointer-events: none;
  border: 1px solid rgba(138, 109, 75, 0.35);
}

.scroll-edges::before {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(138, 109, 75, 0.18);
}

.edge {
  position: absolute;
  background: linear-gradient(to right, transparent, rgba(138, 109, 75, 0.45), transparent);
}

.edge.top,
.edge.bottom {
  left: 6px;
  right: 6px;
  height: 1px;
}

.edge.top {
  top: 6px;
}
.edge.bottom {
  bottom: 6px;
}

.edge.left,
.edge.right {
  top: 6px;
  bottom: 6px;
  width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(138, 109, 75, 0.45), transparent);
}

.edge.left {
  left: 6px;
}
.edge.right {
  right: 6px;
}

.sel-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 4px;
}

.head-line {
  width: 60px;
  height: 1px;
  background: linear-gradient(to right, transparent, var(--brown-warm), transparent);
  position: relative;
}

.head-line::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  width: 6px;
  height: 6px;
  background: var(--brown-warm);
}

.sel-title {
  font-family: 'STXingkai', 'Xingkai SC', 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  font-size: 24px;
  letter-spacing: 6px;
  color: var(--ink-mid);
  font-weight: 600;
}

.sel-sub {
  margin: -6px 0 4px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 5px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.save-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  padding: 2px 4px;
}

.save-card {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.28);
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(90, 60, 20, 0.05);
  transition: all 0.15s ease;
}

.save-card:hover {
  border-color: rgba(138, 109, 75, 0.5);
  box-shadow: 0 3px 8px rgba(90, 60, 20, 0.1);
}

.card-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-label {
  font-size: 15px;
  color: var(--ink-strong);
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  letter-spacing: 1px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badge {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--cinnabar);
  border: 1px solid var(--cinnabar);
  border-radius: 2px;
  padding: 1px 6px;
  letter-spacing: 1px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  opacity: 0.8;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: var(--ink-mid);
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.meta-item {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.meta-key {
  color: var(--ink-soft);
  font-size: 12px;
}

.card-time {
  font-size: 11px;
  color: var(--ink-muted);
  letter-spacing: 1px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.act-btn {
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 2px;
  cursor: pointer;
  letter-spacing: 2px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  transition: all 0.15s ease;
  border: 1px solid rgba(138, 109, 75, 0.4);
  background: var(--paper-hi);
  color: var(--ink-mid);
  white-space: nowrap;
}

.act-btn:hover {
  transform: translateY(-1px);
}

.act-btn.load {
  border-color: var(--cinnabar);
  color: #fff;
  background: linear-gradient(135deg, var(--cinnabar-bright) 0%, var(--cinnabar-deep) 100%);
}

.act-btn.del:hover,
.act-btn.confirm {
  border-color: var(--cinnabar);
  color: var(--cinnabar);
}

.act-btn.confirm {
  background: var(--paper-hi);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px 0;
  color: var(--ink-muted);
  flex: 1;
}

.empty-seal {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cinnabar);
  font-size: 28px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  border: 2px solid var(--cinnabar);
  border-radius: 4px;
  opacity: 0.5;
  transform: rotate(-6deg);
}

.empty p {
  font-size: 13px;
  letter-spacing: 2px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  margin: 0;
}

.new-btn {
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 40px;
  font-size: 17px;
  letter-spacing: 10px;
  color: #fff;
  background: linear-gradient(135deg, var(--cinnabar-bright) 0%, var(--cinnabar-deep) 100%);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  transition: all 0.15s ease;
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3px var(--cinnabar-deep),
    0 6px 14px rgba(120, 30, 20, 0.3);
  margin-top: 6px;
  position: relative;
  overflow: hidden;
}

.new-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.15), transparent 60%);
  pointer-events: none;
}

.new-btn:hover {
  background: linear-gradient(135deg, var(--cinnabar-line) 0%, var(--cinnabar-deep2) 100%);
  transform: translateY(-1px);
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3px var(--cinnabar-deep2),
    0 8px 18px rgba(120, 30, 20, 0.35);
}

.btn-text {
  position: relative;
  z-index: 1;
}
</style>
