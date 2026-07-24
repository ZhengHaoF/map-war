<template>
  <GameModal
    :visible="visible"
    title="电报"
    width="680px"
    variant="parchment"
    :z-index="2000"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="tg-root">
      <!-- 左侧列表 -->
      <div class="tg-sidebar">
        <div class="tg-sidebar-header">
          <span class="tg-sidebar-title">电报</span>
          <span v-if="unreadTotal > 0" class="tg-unread-total">{{ unreadTotal }} 封未读</span>
        </div>
        <div class="tg-list">
          <!-- 世界公屏（置顶） -->
          <div
            class="tg-item"
            :class="{ active: activeChannel === 'world' }"
            @click="selectChannel('world')"
          >
            <div class="tg-avatar tg-avatar--world">世</div>
            <div class="tg-item-body">
              <div class="tg-item-top">
                <span class="tg-item-name">世界频道</span>
                <span class="tg-item-date">公共</span>
              </div>
              <div class="tg-item-last">诸势力时局短评</div>
            </div>
            <span v-if="unreadByChannel['world']" class="tg-badge">{{ unreadByChannel['world'] }}</span>
          </div>

          <div class="tg-section-label">往来势力</div>

          <!-- 往来势力列表 -->
          <div
            v-for="ch in channelList"
            :key="ch.from"
            class="tg-item"
            :class="{ active: activeChannel === ch.from }"
            @click="selectChannel(ch.from)"
          >
            <div class="tg-avatar" :style="avatarStyle(ch.from)">{{ avatarChar(ch.from) }}</div>
            <div class="tg-item-body">
              <div class="tg-item-top">
                <span class="tg-item-name">{{ factionName(ch.from) }}</span>
                <span class="tg-item-date">{{ ch.lastDate }}</span>
              </div>
              <div class="tg-item-last">{{ ch.lastContent }}</div>
            </div>
            <span v-if="unreadByChannel[ch.from]" class="tg-badge">{{ unreadByChannel[ch.from] }}</span>
          </div>

          <div v-if="channelList.length === 0" class="tg-empty-hint">暂无往来电报</div>
        </div>
      </div>

      <!-- 右侧对话 -->
      <div class="tg-chat">
        <!-- 头部 -->
        <div class="tg-chat-header">
          <template v-if="activeChannel === 'world'">
            <div>
              <div class="tg-chat-title">
                <span>世界频道</span>
                <span class="tg-tag tg-tag--world">世界</span>
              </div>
              <div class="tg-chat-sub">诸势力时局短评 · 每日结算后更新</div>
            </div>
          </template>
          <template v-else>
            <div>
              <div class="tg-chat-title">
                <span>{{ factionName(activeChannel) }}</span>
                <span class="tg-tag" :style="tagStyle(activeChannel)">{{ factionLabel(activeChannel) }}</span>
              </div>
              <div class="tg-chat-sub">{{ factionStatus(activeChannel) }}</div>
            </div>
          </template>
          <div class="tg-line-status">
            <span class="tg-line-dot" :class="{ dead: isDead(activeChannel) }"></span>
            {{ isDead(activeChannel) ? '线路中断' : '线路畅通' }}
          </div>
        </div>

        <!-- 消息区 -->
        <div ref="msgRef" class="tg-messages">
          <template v-for="(m, i) in activeMessages" :key="i">
            <!-- 日期分隔 -->
            <div v-if="m.type === 'sep'" class="tg-sep">—— {{ m.text }} ——</div>

            <!-- 玩家消息（右对齐） -->
            <div v-else-if="m.me" class="tg-msg tg-msg--me">
              <div class="tg-bubble tg-bubble--me">{{ m.text }}</div>
            </div>

            <!-- 对方消息（左对齐） -->
            <div v-else class="tg-msg tg-msg--other">
              <div class="tg-msg-avatar" :style="avatarStyle(m.from ?? '')">{{ avatarChar(m.from ?? '') }}</div>
              <div class="tg-msg-body">
                <div class="tg-msg-name" :style="{ color: factionHexColor(m.from ?? '') }">{{ m.leaderName || factionName(m.from ?? '') }}</div>
                <div class="tg-bubble tg-bubble--other">{{ m.text }}</div>
              </div>
            </div>
          </template>

          <!-- 对方正在输入 -->
          <div v-if="typing" class="tg-msg tg-msg--other">
            <div class="tg-msg-avatar" :style="avatarStyle(activeChannel)">
              {{ activeChannel === 'world' ? '议' : avatarChar(activeChannel) }}
            </div>
            <div class="tg-typing">
              <span class="tg-dot"></span><span class="tg-dot"></span><span class="tg-dot"></span>
            </div>
          </div>

          <div v-if="activeMessages.length === 0 && !typing" class="tg-empty-hint">暂无电报</div>
        </div>

        <!-- 输入区 -->
        <div class="tg-input-area">
          <input
            v-model="inputText"
            class="tg-input"
            :placeholder="busy ? '发报中…' : (activeChannel === 'world' ? '向天下喊话……' : `回复${factionName(activeChannel)}……`)"
            :disabled="busy"
            @keydown.enter.prevent="onSend"
          />
          <GameButton parchment :disabled="!inputText.trim() || busy" @click="onSend">
            <IconSend :size="14" />发报
          </GameButton>
        </div>
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useGameStore, type Telegram } from '@/stores/game'
import { Owner, OWNER_LABELS, OWNER_DETAILS, OWNER_COLORS } from '@/data/owners'
import { invokeTelegramReply, type TelegramReplyItem } from '@/utils/aiInvoke'
import GameButton from '@/components/ui/GameButton.vue'
import GameModal from '@/components/ui/GameModal.vue'
import IconSend from '~icons/tabler/send'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const store = useGameStore()
const activeChannel = ref<string>('world')
const inputText = ref('')
const typing = ref(false)
const busy = computed(() => typing.value)
const msgRef = ref<HTMLElement | null>(null)

// ── 未读 ──
const unreadByChannel = computed(() => store.unreadByChannel)
const unreadTotal = computed(() => store.unreadCount)

// ── 左侧列表：按对话对方分组（仅 direct 频道）──
// 分组 key：玩家发给 X 或 X 发给玩家，都归入 X 频道
interface ChannelSummary {
  from: string
  lastContent: string
  lastDate: string
}

const channelList = computed<ChannelSummary[]>(() => {
  const map = new Map<string, Telegram>()
  for (const t of store.telegrams) {
    if (t.channel !== 'direct') continue
    // 确定对话对方：玩家发的 → to 字段；势力发的 → from 字段
    const counterpart = t.from === 'PLAYER' ? (t.to || 'UNKNOWN') : t.from
    if (counterpart === 'UNKNOWN') continue
    const prev = map.get(counterpart)
    if (!prev || t.turn > prev.turn || (t.turn === prev.turn && t.id > prev.id)) {
      map.set(counterpart, t)
    }
  }
  return [...map.entries()]
    .map(([from, t]) => ({ from, lastContent: t.content, lastDate: shortDate(t.gameDate) }))
    .sort((a, b) => b.from.localeCompare(a.from))
})

// ── 右侧消息 ──
interface DisplayMsg {
  type?: 'sep'
  text: string
  me?: boolean
  from?: string
  /** AI 返回的发报人名称（优先显示，不一定是最高领导） */
  leaderName?: string
}

const activeMessages = computed<DisplayMsg[]>(() => {
  const channel = activeChannel.value
  // direct 频道：显示该势力的所有往来电报（玩家发给它的 + 它发给玩家的）
  const msgs = store.telegrams.filter((t) =>
    channel === 'world'
      ? t.channel === 'world'
      : t.channel === 'direct' && (t.from === channel || t.to === channel),
  )

  const result: DisplayMsg[] = []
  let lastDate = ''
  for (const t of msgs) {
    // 日期分隔线
    const d = shortDate(t.gameDate)
    if (d !== lastDate) {
      result.push({ type: 'sep', text: d })
      lastDate = d
    }
    // 玩家发的（from === 'PLAYER'）
    if (t.from === 'PLAYER') {
      result.push({ text: t.content, me: true })
    } else {
      result.push({ text: t.content, from: t.from, leaderName: t.leaderName })
    }
  }
  return result
})

// ── 选中频道 ──
function selectChannel(ch: string): void {
  activeChannel.value = ch
  store.markChannelRead(ch)
  nextTick(scrollBottom)
}

// ── 发送电报 ──
async function onSend(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || typing.value) return
  inputText.value = ''

  const channel = activeChannel.value

  // 玩家电报入 store
  store.pushTelegram({
    gameDate: store.currentDate,
    from: 'PLAYER',
    to: channel === 'world' ? undefined : channel,
    content: text,
    channel: channel === 'world' ? 'world' : 'direct',
    turn: store.turnCount,
  })
  await nextTick()
  scrollBottom()

  // 即时回信
  typing.value = true
  await nextTick()
  scrollBottom()

  try {
    if (channel === 'world') {
      // 世界公屏：多势力回应
      const replies = await invokeWorldReply(text)
      for (const r of replies) {
        store.pushTelegram({
          gameDate: store.currentDate,
          from: r.from,
          content: r.content,
          channel: 'world',
          turn: store.turnCount,
          leaderName: r.leaderName,
        })
      }
    } else {
      // 私信：对应势力回信
      const reply = await invokeDirectReply(channel, text)
      store.pushTelegram({
        gameDate: store.currentDate,
        from: channel,
        to: 'PLAYER',
        content: reply.content,
        channel: 'direct',
        turn: store.turnCount,
        leaderName: reply.leaderName,
      })
    }
  } catch {
    // 静默失败，不影响玩家体验
  } finally {
    typing.value = false
    await nextTick()
    scrollBottom()
  }
}

/** 私信回信（返回 AI 名字和内容） */
async function invokeDirectReply(faction: string, playerMsg: string): Promise<{ content: string; leaderName: string }> {
  const detail = OWNER_DETAILS[faction]
  const label = OWNER_LABELS[faction as Owner] ?? faction
  const leader = detail?.leader ?? label

  // 取最近 6 条对话作为上下文
  const history = store.telegrams
    .filter((t) => t.channel === 'direct' && (t.from === faction || t.to === faction))
    .slice(-6)
    .map((t) => ({ from: t.from === 'PLAYER' ? 'player' as const : 'faction' as const, text: t.content }))

  const situation = `${label}，拥有${store.factionCities(faction as Owner).length}城，兵力约${store.factionTroops(faction as Owner)}k`

  const items = await invokeTelegramReply({
    factionName: leader,
    factionTag: label,
    factionCode: faction,
    personality: detail?.description?.slice(0, 20) ?? '沉稳',
    situation,
    recentChat: history,
    playerMessage: playerMsg,
    mode: 'direct',
  })
  return { content: items[0]?.content ?? '……', leaderName: items[0]?.name ?? leader }
}

/** 世界公屏回信：多势力各自回应 */
async function invokeWorldReply(playerMsg: string): Promise<{ from: string; content: string; leaderName: string }[]> {
  const alive = store.activeFactions.filter((f) => f !== store.currentFaction)
  if (!alive.length) return [{ from: 'SYSTEM', content: '（天下寂然，无人应答）', leaderName: '系统' }]

  const items: TelegramReplyItem[] = await invokeTelegramReply({
    factionName: '',
    factionTag: '',
    personality: '',
    situation: buildWorldSituation(),
    recentChat: store.telegrams.filter((t) => t.channel === 'world').slice(-4).map((t) => ({
      from: (t.from === 'PLAYER' ? 'player' : 'faction') as 'player' | 'faction',
      text: t.content,
      name: t.leaderName ?? factionName(t.from),
    })),
    playerMessage: playerMsg,
    mode: 'world',
  })

  // AI 返回的 faction 已是代号（如 KMT），直接使用
  return items.map((it) => ({
    from: it.faction,
    content: it.content,
    leaderName: it.name,
  }))
}

/** 构建世界局势一句话（供世界公屏 prompt） */
function buildWorldSituation(): string {
  return store.activeFactions
    .filter((f) => f !== store.currentFaction)
    .map((f) => `${OWNER_LABELS[f]}（${store.factionCities(f).length}城）`)
    .join('、')
}

// ── 辅助函数 ──
function scrollBottom(): void {
  if (msgRef.value) msgRef.value.scrollTop = msgRef.value.scrollHeight
}

function shortDate(iso: string): string {
  // '1931-04-01' → '1931年4月'
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return iso
  return `${m[1]}年${parseInt(m[2])}月`
}

function factionName(from: string): string {
  if (from === 'world') return '世界频道'
  const detail = OWNER_DETAILS[from]
  return detail?.leader ?? OWNER_LABELS[from as Owner] ?? from
}

function factionLabel(from: string): string {
  return OWNER_LABELS[from as Owner] ?? from
}

function factionStatus(from: string): string {
  const owner = from as Owner
  if (!store.isAlive(owner)) return '已覆灭'
  const cities = store.factionCities(owner).length
  const troops = store.factionTroops(owner)
  return `存活 · ${cities}城 · 兵力${troops}k`
}

function isDead(from: string): boolean {
  if (from === 'world') return false
  return !store.isAlive(from as Owner)
}

function factionHexColor(from: string): string {
  const hex = OWNER_COLORS[from as Owner]
  if (hex === undefined) return '#666'
  return '#' + hex.toString(16).padStart(6, '0')
}

function avatarChar(from: string): string {
  if (from === 'world') return '世'
  const detail = OWNER_DETAILS[from]
  return detail?.leader?.[0] ?? (OWNER_LABELS[from as Owner]?.[0] ?? from[0])
}

function avatarStyle(from: string): Record<string, string> {
  const color = factionHexColor(from)
  return {
    background: color + '18',
    color,
    border: `1px solid ${color}40`,
  }
}

function tagStyle(from: string): Record<string, string> {
  const color = factionHexColor(from)
  return {
    background: color + '18',
    color,
    border: `1px solid ${color}40`,
  }
}

// 面板打开时自动滚动到底部
watch(
  () => activeMessages.value.length,
  () => nextTick(scrollBottom),
)
</script>

<style scoped>
/* ===== 根布局：左右分栏 ===== */
.tg-root {
  display: flex;
  height: 480px;
  overflow: hidden;
}

/* ===== 左侧列表 ===== */
.tg-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--brown-line, #b8a07a);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tg-sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 12px 6px;
}

.tg-sidebar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-strong, #2c1a0a);
}

.tg-unread-total {
  font-size: 11px;
  color: var(--cinnabar, #b04a3a);
}

.tg-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}

.tg-section-label {
  padding: 8px 12px 4px;
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
  letter-spacing: 1px;
}

.tg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s;
}

.tg-item:hover {
  background: var(--paper-faint, #e8dcc0);
}

.tg-item.active {
  background: var(--paper-faint, #e8dcc0);
  border-left-color: var(--cinnabar, #b04a3a);
}

.tg-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.tg-avatar--world {
  background: var(--ink-strong, #2c1a0a);
  color: var(--paper-deep, #f5edd8);
}

.tg-item-body {
  flex: 1;
  min-width: 0;
}

.tg-item-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.tg-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-strong, #2c1a0a);
}

.tg-item-date {
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
}

.tg-item-last {
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.tg-badge {
  min-width: 16px;
  height: 16px;
  border-radius: 99px;
  background: var(--cinnabar, #b04a3a);
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  flex-shrink: 0;
}

.tg-empty-hint {
  text-align: center;
  padding: 24px 0;
  color: var(--ink-muted, #9c8a6a);
  font-size: 13px;
}

/* ===== 右侧对话 ===== */
.tg-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tg-chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--brown-line, #b8a07a);
}

.tg-chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-strong, #2c1a0a);
}

.tg-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 99px;
  font-weight: 500;
}

.tg-tag--world {
  background: var(--ink-strong, #2c1a0a);
  color: var(--paper-deep, #f5edd8);
}

.tg-chat-sub {
  font-size: 12px;
  color: var(--ink-muted, #9c8a6a);
  margin-top: 2px;
}

.tg-line-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
}

.tg-line-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4a8c3f;
  animation: tgPulse 2s infinite;
}

.tg-line-dot.dead {
  background: #888;
  animation: none;
}

@keyframes tgPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ===== 消息区 ===== */
.tg-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tg-sep {
  text-align: center;
  font-size: 11px;
  color: var(--ink-muted, #9c8a6a);
  letter-spacing: 2px;
  margin: 6px 0;
}

.tg-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.tg-msg--me {
  justify-content: flex-end;
}

.tg-msg-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.tg-msg-body {
  max-width: 72%;
}

.tg-msg-name {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 2px;
}

.tg-bubble {
  padding: 7px 11px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}

.tg-bubble--me {
  background: var(--paper-dark, #d6c3a0);
  color: var(--ink-strong, #2c1a0a);
  border: 1px solid var(--brown-line, #b8a07a);
  border-bottom-right-radius: 4px;
  max-width: 72%; /* 与对方气泡（.tg-msg-body）宽度约束保持一致 */
}

.tg-bubble--other {
  background: var(--paper-faint, #e8dcc0);
  color: var(--ink, #3b2f1d);
  border: 1px solid var(--brown-line, #b8a07a);
  border-top-left-radius: 4px;
}

/* ===== 正在输入 ===== */
.tg-typing {
  background: var(--paper-faint, #e8dcc0);
  border: 1px solid var(--brown-line, #b8a07a);
  border-radius: 10px;
  border-top-left-radius: 4px;
  padding: 10px 14px;
  display: flex;
  gap: 4px;
}

.tg-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ink-muted, #9c8a6a);
  animation: tgDotBounce 1.2s infinite;
}

.tg-dot:nth-child(2) { animation-delay: 0.2s; }
.tg-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes tgDotBounce {
  0%, 80%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}

/* ===== 输入区 ===== */
.tg-input-area {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--brown-line, #b8a07a);
}

.tg-input {
  flex: 1;
  background: var(--paper-input, #fbf6ea);
  border: 1px solid var(--brown-line, #8a6d4b);
  border-radius: var(--radius-md);
  color: var(--ink, #3b2f1d);
  font-size: 14px;
  font-family: inherit;
  padding: 8px 10px;
  outline: none;
}

.tg-input:focus {
  border-color: var(--cinnabar, #b23a2e);
  background: var(--paper-hi, #fff);
}

.tg-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--paper-faint, #e8dcc0);
}

/* ===== 滚动条 ===== */
.tg-list::-webkit-scrollbar,
.tg-messages::-webkit-scrollbar {
  width: 6px;
}

.tg-list::-webkit-scrollbar-thumb,
.tg-messages::-webkit-scrollbar-thumb {
  background: rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
}
</style>
