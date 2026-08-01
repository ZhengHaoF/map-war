<template>
  <GameModal
    :visible="visible"
    title="外交"
    width="700px"
    variant="parchment"
    :z-index="2000"
    draggable
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="dip-root">
      <div class="dip-tabs">
        <button :class="['dip-tab', { active: tab === 'telegram' }]" @click="tab = 'telegram'">
          电报
          <span v-if="unreadTotal > 0" class="dip-tab-badge">{{ unreadTotal > 9 ? '9+' : unreadTotal }}</span>
        </button>
        <button :class="['dip-tab', { active: tab === 'envoy' }]" @click="tab = 'envoy'">
          遣使
          <span v-if="hasEnvoyPending" class="dip-tab-badge dip-tab-badge--envoy">使者</span>
        </button>
      </div>

      <div class="dip-content">
        <TelegramTab v-show="tab === 'telegram'" @envoy="onEnvoyFromTelegram" />
        <EnvoyTab v-show="tab === 'envoy'" :prefill="envoyPrefill" />
      </div>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import GameModal from '@/components/ui/GameModal.vue'
import TelegramTab from '@/components/TelegramTab.vue'
import EnvoyTab from '@/components/EnvoyTab.vue'

defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const store = useGameStore()
const bus = useDiplomacyBus()

const tab = ref<'telegram' | 'envoy'>('telegram')
const envoyPrefill = ref<{ targetFaction: string; intentText: string } | null>(null)

const unreadTotal = computed(() => store.unreadCount)
const hasEnvoyPending = computed(() => {
  const s = bus.currentSession.value
  return s && s.status === 'negotiating'
})

function onEnvoyFromTelegram(payload: { targetFaction: string; intentText: string }): void {
  envoyPrefill.value = payload
  tab.value = 'envoy'
}

watch(
  () => store.telegramRequest,
  (req) => {
    if (!req) return
    tab.value = 'telegram'
  },
)
</script>

<style scoped>
.dip-root {
  display: flex;
  flex-direction: column;
  height: 520px;
  overflow: hidden;
}

.dip-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--brown-line-faint, rgba(138, 109, 75, 0.22));
  padding: 0 12px;
  flex-shrink: 0;
}

.dip-tab {
  position: relative;
  padding: 8px 18px;
  border: none;
  background: transparent;
  color: var(--ink-soft, #7a5c38);
  font-family: var(--font-song, serif);
  font-size: 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.dip-tab.active {
  color: var(--cinnabar, #b04a3a);
  border-bottom-color: var(--cinnabar, #b04a3a);
}

.dip-tab-badge {
  font-size: 10px;
  background: var(--cinnabar, #b04a3a);
  color: var(--paper-hi, #f1e9d3);
  padding: 0 5px;
  border-radius: 999px;
  margin-left: 4px;
  vertical-align: middle;
}

.dip-tab-badge--envoy {
  background: #96802f;
}

.dip-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
