<template>
  <GameModal
    :visible="visible"
    title="遣使"
    width="480px"
    variant="parchment"
    @close="$emit('close')"
  >
    <div class="dp-shell">
      <!-- tabs -->
      <div class="dp-tabs">
        <button :class="['dp-tab', { active: tab === 'new' }]" @click="tab = 'new'">遣使</button>
        <button :class="['dp-tab', { active: tab === 'history' }]" @click="tab = 'history'">
          史册 <span v-if="historyRecords.length" class="dp-tab-count">{{ historyRecords.length }}</span>
        </button>
      </div>

      <!-- 新建协商 -->
      <template v-if="tab === 'new'">
        <div v-if="!session" class="dp-new">
          <label class="dp-label">遣使何方</label>
          <select v-model="targetFaction" class="dp-select">
            <option :value="null" disabled>—— 择一势力 ——</option>
            <option v-for="f in targetOptions" :key="f" :value="f">
              {{ OWNER_LABELS[f] ?? f }}
            </option>
          </select>

          <label class="dp-label">使团缘起</label>
          <textarea
            v-model="intentText"
            class="dp-textarea"
            placeholder="陈明意图……（如：愿与贵部结盟共御日军、请借道汉中、提议停战）"
            rows="3"
            :disabled="loading"
          ></textarea>

          <GameButton parchment :disabled="!canSend || loading" @click="onStart">
            <component :is="IconSend" :size="14" />
            {{ loading ? '遣使中…' : '遣使' }}
          </GameButton>
        </div>

        <!-- 进行中的协商 -->
        <div v-else class="dp-chat">
          <div class="dp-chat-header">
            与 <strong>{{ targetLabel }}</strong> 的使团 —— 第 {{ session.rounds.length }} 轮
          </div>
          <div class="dp-rounds">
            <div
              v-for="r in session.rounds"
              :key="r.round"
              class="dp-round"
            >
              <div v-if="r.playerMessage" class="dp-msg dp-msg--player">
                <div class="dp-msg-label">我</div>
                <div class="dp-bubble dp-bubble--player">{{ r.playerMessage }}</div>
              </div>
              <div class="dp-msg dp-msg--target">
                <div class="dp-msg-label">{{ targetLabel }}</div>
                <div class="dp-bubble dp-bubble--target">
                  <div class="dp-stance" :class="`dp-stance--${r.stance}`">
                    {{ r.stance === 'accept' ? '✓ 应允' : r.stance === 'reject' ? '✗ 婉拒' : '↺ 提议/还价' }}
                  </div>
                  <p>{{ r.reply }}</p>
                  <div v-if="r.counterOffer" class="dp-counter">反提议：{{ r.counterOffer }}</div>
                  <div v-if="r.conditions?.length" class="dp-conds">
                    <span v-for="(c, i) in r.conditions" :key="i" class="dp-cond-tag">{{ formatCond(c) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 操作区 -->
          <div v-if="canContinue" class="dp-actions">
            <textarea
              v-model="replyText"
              class="dp-textarea"
              placeholder="还价/陈情……（如：愿结盟，但须再赔银20万）"
              rows="2"
              :disabled="loading"
            ></textarea>
            <div class="dp-act-row">
              <GameButton parchment active @click="onForceSettle" :disabled="loading">
                <component :is="IconCheck" :size="14" />
                同意协定
              </GameButton>
              <GameButton parchment :disabled="!replyText.trim() || loading" @click="onContinue">
                <component :is="IconSend" :size="14" />
                {{ loading ? '发报中…' : '还价反提议' }}
              </GameButton>
              <GameButton parchment danger @click="onReject" :disabled="loading">
                <component :is="IconX" :size="14" />
                严词拒绝
              </GameButton>
            </div>
          </div>
          <div v-else class="dp-done">
            <p>对方已表态，请收口或搁置。</p>
            <div class="dp-act-row">
              <GameButton parchment active @click="onForceSettle" :disabled="loading">
                <component :is="IconCheck" :size="14" />
                收口定论
              </GameButton>
              <GameButton parchment danger @click="onCancel" :disabled="loading">
                <component :is="IconX" :size="14" />
                搁置
              </GameButton>
            </div>
          </div>
        </div>
      </template>

      <!-- 史册 -->
      <template v-if="tab === 'history'">
        <div v-if="historyRecords.length === 0" class="dp-empty">暂无外交记录</div>
        <div v-else class="dp-history">
          <div
            v-for="r in historyRecords"
            :key="r.id"
            class="dp-hist-item"
          >
            <div class="dp-hist-head">
              <span class="dp-hist-target">{{ OWNER_LABELS[r.targetFaction] ?? r.targetFaction }}</span>
              <span class="dp-hist-badge" :class="`dp-hist-badge--${r.status}`">
                {{ r.status === 'settled' ? (r.finalStance === 'accept' ? '达成' : r.finalStance === 'reject' ? '破裂' : '收口') : '搁置' }}
              </span>
              <span class="dp-hist-date">{{ r.createdAt }}</span>
            </div>
            <div class="dp-hist-intent">{{ INTENT_LABELS[r.intent] ?? r.intent }} · {{ r.rounds.length }} 轮</div>
            <div
              v-if="r.settleNarrative"
              class="dp-hist-narr"
            >{{ r.settleNarrative }}</div>
          </div>
        </div>
      </template>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { INTENT_LABELS } from '@/utils/diplomacy'
import type { Condition } from '@/utils/diplomacy'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
import IconSend from '~icons/tabler/send'
import IconCheck from '~icons/tabler/check'
import IconX from '~icons/tabler/x'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const store = useGameStore()
const bus = useDiplomacyBus()

const tab = ref<'new' | 'history'>('new')
const targetFaction = ref<Owner | null>(null)
const intentText = ref('')
const replyText = ref('')
const loading = ref(false)

const session = computed(() => bus.currentSession.value)
const historyRecords = computed(() =>
  store.diplomacyRecords.filter((r) => r.status !== 'negotiating'),
)

const targetOptions = computed(() =>
  store.activeFactions.filter(
    (f) => f !== store.currentFaction && f !== Owner.NEUTRAL,
  ),
)

const targetLabel = computed(() =>
  session.value ? (OWNER_LABELS[session.value.targetFaction] ?? session.value.targetFaction) : '',
)

const canSend = computed(() => targetFaction.value && intentText.value.trim())

const canContinue = computed(() => {
  if (!session.value) return false
  const last = session.value.rounds[session.value.rounds.length - 1]
  return last?.stance === 'counter'
})

function formatCond(c: Condition): string {
  if (c.type === 'cedeCity') return `割让 ${c.city ?? '?'}`
  if (c.type === 'transferSilver') return `要银 ${c.amount ?? '?'} 万`
  if (c.type === 'transferFood') return `要粮 ${c.amount ?? '?'} 万石`
  if (c.type === 'verbal') return c.text ?? ''
  return String(c)
}

// ── 操作 ─────────────────────────────────────────────────

async function onStart() {
  if (!targetFaction.value || !intentText.value.trim()) return
  loading.value = true
  try {
    await bus.startDiplomacy(intentText.value.trim(), targetFaction.value)
  } finally {
    loading.value = false
    intentText.value = ''
  }
}

async function onContinue() {
  if (!replyText.value.trim()) return
  loading.value = true
  try {
    await bus.continueNegotiation(replyText.value.trim())
    replyText.value = ''
  } finally {
    loading.value = false
  }
}

async function onForceSettle() {
  loading.value = true
  try {
    await bus.forceSettle()
    tab.value = 'history'
  } finally {
    loading.value = false
  }
}

async function onReject() {
  if (!session.value) return
  loading.value = true
  try {
    const last = session.value.rounds[session.value.rounds.length - 1]
    if (last) last.stance = 'reject'
    await bus.forceSettle()
    tab.value = 'history'
  } finally {
    loading.value = false
  }
}

function onCancel() {
  bus.cancelDiplomacy()
  tab.value = 'history'
}
</script>

<style scoped>
.dp-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 82vh;
  padding: 14px;
}

.dp-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--brown-line-faint, rgba(138,109,75,0.22));
  padding-bottom: 0;
}
.dp-tab {
  padding: 6px 16px;
  border: none;
  background: transparent;
  color: var(--ink-soft, #7a5c38);
  font-family: var(--font-song, serif);
  font-size: 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.dp-tab.active {
  color: var(--cinnabar, #b04a3a);
  border-bottom-color: var(--cinnabar, #b04a3a);
}
.dp-tab-count {
  font-size: 11px;
  background: var(--cinnabar, #b04a3a);
  color: var(--paper-hi, #f1e9d3);
  padding: 0 5px;
  border-radius: 999px;
  margin-left: 4px;
}

/* 新建 */
.dp-new {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dp-label {
  font-family: var(--font-song, serif);
  font-size: 13px;
  color: var(--ink-soft, #7a5c38);
}
.dp-select, .dp-textarea {
  font-family: var(--font-song, serif);
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--brown-line, #b8a07a);
  border-radius: var(--radius-sm, 4px);
  background: var(--paper-input, #e6d8bd);
  color: var(--ink, #3b2a18);
  resize: vertical;
  outline: none;
}
.dp-select:focus, .dp-textarea:focus {
  border-color: var(--cinnabar, #b04a3a);
}

/* 协商对话 */
.dp-chat { display: flex; flex-direction: column; gap: 10px; }
.dp-chat-header {
  font-family: var(--font-song, serif);
  font-size: 13px;
  color: var(--ink-soft, #7a5c38);
  text-align: center;
}
.dp-rounds {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}
.dp-round {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dp-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.dp-msg-label {
  font-family: var(--font-song, serif);
  font-size: 12px;
  color: var(--ink-muted, #9a8560);
  min-width: 36px;
  text-align: right;
  padding-top: 4px;
}
.dp-msg--player { align-self: flex-end; flex-direction: row-reverse; }
.dp-msg--player .dp-msg-label { text-align: left; }
.dp-bubble {
  font-family: var(--font-song, serif);
  font-size: 13px;
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 4px);
  max-width: 480px;
}
.dp-bubble--player {
  background: var(--paper-hi2, #e3d6bb);
  color: var(--ink, #3b2a18);
  border: 1px solid var(--brown-line-faint, rgba(138,109,75,0.22));
}
.dp-bubble--target {
  background: var(--paper-head, #e0d1b1);
  color: var(--ink, #3b2a18);
  border: 1px solid rgba(176, 74, 58, 0.15);
}
.dp-stance {
  font-size: 11px;
  font-weight: bold;
  margin-bottom: 4px;
}
.dp-stance--accept { color: #4a8020; }
.dp-stance--reject { color: var(--cinnabar, #b04a3a); }
.dp-stance--counter { color: var(--brown-warm, #a08050); }
.dp-counter {
  font-size: 12px;
  color: var(--brown-warm, #a08050);
  margin-top: 4px;
  font-style: italic;
}
.dp-conds { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.dp-cond-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(176, 74, 58, 0.10);
  color: var(--cinnabar-ink, #7a2a1a);
}

/* 操作区 */
.dp-actions, .dp-done {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--brown-line-faint, rgba(138,109,75,0.22));
}
.dp-done p {
  font-family: var(--font-song, serif);
  font-size: 13px;
  color: var(--ink-soft, #7a5c38);
  text-align: center;
}
.dp-act-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* 史册 */
.dp-empty {
  font-family: var(--font-song, serif);
  font-size: 13px;
  color: var(--ink-muted, #9a8560);
  text-align: center;
  padding: 24px 0;
}
.dp-history {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 480px;
  overflow-y: auto;
}
.dp-hist-item {
  padding: 8px 10px;
  border: 1px solid var(--brown-line-faint, rgba(138,109,75,0.22));
  border-radius: var(--radius-sm, 4px);
  background: var(--paper-panel, #e9dcc4);
}
.dp-hist-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.dp-hist-target {
  font-family: var(--font-song, serif);
  font-size: 14px;
  color: var(--ink-strong, #2c1a0a);
  font-weight: bold;
}
.dp-hist-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
}
.dp-hist-badge--settled { background: rgba(74, 128, 32, 0.12); color: #4a8020; }
.dp-hist-badge--abandoned { background: rgba(26,10,10,0.08); color: var(--ink-muted, #9a8560); }
.dp-hist-date {
  font-size: 11px;
  color: var(--ink-muted, #9a8560);
  margin-left: auto;
}
.dp-hist-intent {
  font-size: 12px;
  color: var(--ink-soft, #7a5c38);
}
.dp-hist-narr {
  font-size: 12px;
  color: var(--ink-muted, #9a8560);
  font-style: italic;
  margin-top: 4px;
  line-height: 1.5;
}
</style>
