<template>
  <div class="onboarding">
    <div class="onboard-head">
      <span class="head-line" />
      <h2 class="onboard-title">一九三一 · 山河破碎</h2>
      <span class="head-line" />
    </div>
    <p class="onboard-sub">择一方势力，救万民于水火</p>

    <div class="onboard-body">
      <div class="onboard-left">
        <div class="name-section">
          <div class="section-label">▎将领名册</div>
          <input
            v-model.trim="name"
            class="name-input"
            placeholder="提笔书就将军之名..."
            maxlength="12"
            @keyup.enter="handleEnter"
          />
          <p v-if="nameError" class="name-error">{{ nameError }}</p>
        </div>

        <div v-if="selectedOwner" class="detail-panel">
          <div class="panel-head" :style="{ borderColor: '#' + ownerHex(selectedOwner) }">
            <span class="panel-mark" :style="{ background: '#' + ownerHex(selectedOwner) }" />
            <span>{{ OWNER_LABELS[selectedOwner] }}</span>
          </div>
          <div class="panel-body">
            <div class="panel-row">
              <span class="panel-key">全称</span>
              <span class="panel-val">{{ detail?.fullName }}</span>
            </div>
            <div class="panel-row">
              <span class="panel-key">治所</span>
              <span class="panel-val">{{ detail?.capital }}</span>
            </div>
            <div class="panel-row">
              <span class="panel-key">统帅</span>
              <span class="panel-val">{{ detail?.leader }}</span>
            </div>
            <div class="panel-row">
              <span class="panel-key">兵力</span>
              <span class="panel-val">{{ detail?.strength }}</span>
            </div>
            <div class="panel-sep" />
            <p class="panel-desc">{{ detail?.description }}</p>
          </div>
        </div>
      </div>

      <div class="onboard-right">
        <div class="section-label">▎势力名录</div>
        <div class="faction-grid">
          <button
            v-for="owner in owners"
            :key="owner"
            class="faction-card"
            :class="{ selected: selectedOwner === owner }"
            :style="cardStyle(owner)"
            @click="selectedOwner = owner"
          >
            <span class="card-mark" :style="{ background: '#' + ownerHex(owner) }" />
            <span class="card-name">{{ OWNER_LABELS[owner] }}</span>
          </button>
        </div>
      </div>
    </div>

    <button
      class="enter-btn"
      :disabled="!canEnter"
      @click="handleEnter"
    >
      开 战
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Owner, OWNER_LABELS, OWNER_COLORS, OWNER_DETAILS } from '@/data/owners'
import { useGameStore } from '@/stores/game'

const gameStore = useGameStore()
const owners = [Owner.KMT, Owner.CCP, Owner.JPN, Owner.NEA, Owner.SHX, Owner.GXC, Owner.SCC, Owner.MA, Owner.XJ, Owner.TIB]

const name = ref('')
const selectedOwner = ref<Owner | null>(null)
const nameError = ref('')

const detail = computed(() => (selectedOwner.value ? OWNER_DETAILS[selectedOwner.value] : null))
const canEnter = computed(() => name.value.trim().length > 0 && selectedOwner.value !== null)

function ownerHex(owner: Owner): string {
  return (OWNER_COLORS[owner] ?? 0x888888).toString(16).padStart(6, '0')
}

function cardStyle(owner: Owner) {
  const hex = ownerHex(owner)
  if (selectedOwner.value === owner) {
    return {
      borderColor: `#${hex}`,
      background: `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, 0.1)`,
    }
  }
  return {}
}

function handleEnter() {
  nameError.value = ''
  if (!name.value.trim()) { nameError.value = '请提笔书名'; return }
  if (!selectedOwner.value) { nameError.value = '请择一势力'; return }
  gameStore.setPlayer(name.value.trim(), selectedOwner.value)
}
</script>

<style scoped>
.onboarding {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.onboard-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.head-line {
  width: 40px;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(200, 160, 80, 0.6), transparent);
}

.onboard-title {
  margin: 0;
  font-size: 20px;
  color: #c9a04b;
  letter-spacing: 6px;
  font-family: Georgia, 'Songti SC', 'SimSun', serif;
}

.onboard-sub {
  margin: -10px 0 0;
  text-align: center;
  font-size: 12px;
  color: #8a7a60;
  letter-spacing: 3px;
  font-family: Georgia, 'Songti SC', serif;
}

.section-label {
  font-size: 11px;
  color: #6a5a40;
  letter-spacing: 3px;
  margin-bottom: 8px;
}

.onboard-body {
  display: flex;
  gap: 32px;
}

.onboard-left {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.name-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.name-input {
  background: rgba(30, 22, 10, 0.5);
  border: 1px solid rgba(180, 150, 100, 0.2);
  border-radius: 2px;
  color: #d0c0a0;
  font-size: 14px;
  padding: 8px 12px;
  outline: none;
  letter-spacing: 2px;
  font-family: Georgia, 'Songti SC', serif;
}

.name-input:focus {
  border-color: rgba(200, 160, 80, 0.5);
  background: rgba(30, 22, 10, 0.7);
}

.name-input::placeholder {
  color: #5a4a30;
  letter-spacing: 1px;
}

.name-error {
  color: #b04040;
  font-size: 11px;
  margin: 0;
}

.detail-panel {
  border: 1px solid rgba(180, 150, 100, 0.15);
  background: rgba(20, 14, 6, 0.5);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(180, 150, 100, 0.15);
  font-size: 14px;
  color: #d0c0a0;
  font-family: Georgia, 'Songti SC', serif;
  letter-spacing: 1px;
}

.panel-mark {
  width: 3px;
  height: 14px;
  flex-shrink: 0;
}

.panel-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-row {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.panel-key {
  color: #6a5a40;
  min-width: 32px;
  flex-shrink: 0;
}

.panel-val {
  color: #b0a080;
}

.panel-sep {
  height: 1px;
  background: rgba(180, 150, 100, 0.1);
  margin: 6px 0;
}

.panel-desc {
  margin: 0;
  font-size: 12px;
  color: #908060;
  line-height: 1.8;
}

.onboard-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.faction-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.faction-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(20, 14, 6, 0.3);
  border: 1px solid rgba(180, 150, 100, 0.1);
  cursor: pointer;
  color: #b0a080;
  font-size: 13px;
  font-family: Georgia, 'Songti SC', serif;
  letter-spacing: 1px;
  transition: all 0.12s;
}

.faction-card:hover {
  background: rgba(30, 22, 10, 0.6);
  border-color: rgba(180, 150, 100, 0.25);
  color: #d0c0a0;
}

.faction-card.selected {
  border-width: 1px;
  color: #e0d0b0;
}

.card-mark {
  width: 3px;
  height: 12px;
  flex-shrink: 0;
}

.card-name {}

.enter-btn {
  padding: 10px 0;
  font-size: 18px;
  letter-spacing: 12px;
  color: #1a1208;
  background: linear-gradient(to bottom, #d4a84b, #b8892e);
  border: 1px solid #8a6518;
  cursor: pointer;
  font-family: Georgia, 'Songti SC', serif;
  transition: all 0.15s;
}

.enter-btn:hover:not(:disabled) {
  background: linear-gradient(to bottom, #e0b85a, #c99a38);
}

.enter-btn:disabled {
  background: rgba(180, 150, 100, 0.15);
  border-color: rgba(180, 150, 100, 0.08);
  color: rgba(180, 150, 100, 0.2);
  cursor: not-allowed;
}
</style>
