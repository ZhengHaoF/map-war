<template>
  <div class="onboarding">
    <div class="scroll-edges">
      <span class="edge top" />
      <span class="edge right" />
      <span class="edge bottom" />
      <span class="edge left" />
    </div>

    <div class="corner-ornament tl" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        <path
          d="M2 38 L2 12 Q2 2 12 2 L38 2"
          fill="none"
          stroke="var(--brown)"
          stroke-width="1.5"
        />
        <path
          d="M8 38 L8 18 Q8 8 18 8 L38 8"
          fill="none"
          stroke="var(--brown-line)"
          stroke-width="0.8"
        />
      </svg>
    </div>
    <div class="corner-ornament tr" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        <path
          d="M38 38 L38 12 Q38 2 28 2 L2 2"
          fill="none"
          stroke="var(--brown)"
          stroke-width="1.5"
        />
        <path
          d="M32 38 L32 18 Q32 8 22 8 L2 8"
          fill="none"
          stroke="var(--brown-line)"
          stroke-width="0.8"
        />
      </svg>
    </div>
    <div class="corner-ornament bl" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        <path
          d="M2 2 L2 28 Q2 38 12 38 L38 38"
          fill="none"
          stroke="var(--brown)"
          stroke-width="1.5"
        />
        <path
          d="M8 2 L8 22 Q8 32 18 32 L38 32"
          fill="none"
          stroke="var(--brown-line)"
          stroke-width="0.8"
        />
      </svg>
    </div>
    <div class="corner-ornament br" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        <path
          d="M38 2 L38 28 Q38 38 28 38 L2 38"
          fill="none"
          stroke="var(--brown)"
          stroke-width="1.5"
        />
        <path
          d="M32 2 L32 22 Q32 32 22 32 L2 32"
          fill="none"
          stroke="var(--brown-line)"
          stroke-width="0.8"
        />
      </svg>
    </div>

    <button v-if="showBack" class="back-link" @click="$emit('back')">
      <span class="back-arrow">‹</span>
      返回存档
    </button>

    <div class="onboard-head">
      <span class="head-line" />
      <div class="title-block">
        <span class="title-year">一九三一</span>
        <!--        <span class="title-dot">·</span>-->
        <!--        <span class="title-theme">山河破碎</span>-->
      </div>
      <span class="head-line" />
    </div>

    <p class="onboard-sub">择一方势力</p>

    <div class="onboard-body">
      <div class="onboard-left">
        <div class="name-section">
          <div class="section-label">
            <span class="label-mark" />
            将领名册
          </div>
          <div class="input-frame">
            <input
              v-model.trim="name"
              class="name-input"
              placeholder="提笔书就将军之名..."
              maxlength="12"
              @keyup.enter="handleEnter"
            />
          </div>
          <p v-if="nameError" class="name-error">{{ nameError }}</p>
        </div>

        <div v-if="selectedOwner" class="detail-panel">
          <div class="panel-scroll-cap" />
          <div class="panel-head" :style="{ borderColor: '#' + ownerHex(selectedOwner) }">
            <span class="panel-seal" :style="{ background: '#' + ownerHex(selectedOwner) }">
              {{ OWNER_LABELS[selectedOwner].slice(0, 1) }}
            </span>
            <span class="panel-name">{{ OWNER_LABELS[selectedOwner] }}</span>
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
          <div class="panel-scroll-foot" />
        </div>

        <div v-else class="detail-panel empty">
          <div class="panel-scroll-cap" />
          <div class="empty-body">
            <span class="empty-seal">择</span>
            <p>请在右侧名录中择一势力</p>
          </div>
          <div class="panel-scroll-foot" />
        </div>
      </div>

      <div class="onboard-right">
        <div class="section-label">
          <span class="label-mark" />
          势力名录
        </div>
        <div class="faction-grid">
          <button
            v-for="owner in owners"
            :key="owner"
            class="faction-card"
            :class="{ selected: selectedOwner === owner }"
            :style="cardStyle(owner)"
            @click="selectedOwner = owner"
          >
            <span class="card-seal" :style="{ background: '#' + ownerHex(owner) }">
              {{ OWNER_LABELS[owner].slice(0, 1) }}
            </span>
            <span class="card-name">{{ OWNER_LABELS[owner] }}</span>
          </button>
        </div>
      </div>
    </div>

    <button class="enter-btn" :disabled="!canEnter" @click="handleEnter">
      <span class="btn-text">开 战</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Owner, OWNER_LABELS, OWNER_COLORS, OWNER_DETAILS } from '@/data/owners'
import { useGameStore } from '@/stores/game'

defineProps<{
  /** 是否显示"返回存档"链接（仅当存在存档且从选择器点新游戏进来时） */
  showBack?: boolean
}>()

defineEmits<{
  back: []
}>()

const gameStore = useGameStore()
const owners = [
  Owner.KMT,
  Owner.CCP,
  Owner.JPN,
  Owner.NEA,
  Owner.SHX,
  Owner.GXC,
  Owner.SCC,
  Owner.MA,
  Owner.XJ,
  Owner.TIB,
]

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
      background: `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, 0.08)`,
      boxShadow: `0 0 0 1px #${hex}30 inset`,
    }
  }
  return {}
}

function handleEnter() {
  nameError.value = ''
  if (!name.value.trim()) {
    nameError.value = '请提笔书名'
    return
  }
  if (!selectedOwner.value) {
    nameError.value = '请择一势力'
    return
  }
  gameStore.setPlayer(name.value.trim(), selectedOwner.value)
}
</script>

<style scoped>
.onboarding {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 42px 44px 34px;
  background:
    radial-gradient(circle at 18% 22%, rgba(160, 110, 50, 0.06) 0%, transparent 45%),
    radial-gradient(circle at 82% 78%, rgba(140, 90, 40, 0.05) 0%, transparent 40%),
    radial-gradient(circle at 60% 12%, rgba(180, 130, 60, 0.04) 0%, transparent 35%), var(--paper);
  color: var(--ink);
  min-height: 480px;
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

/* 四角回纹 */
.corner-ornament {
  position: absolute;
  width: 40px;
  height: 40px;
  pointer-events: none;
  opacity: 0.85;
}

.corner-ornament.tl {
  top: 6px;
  left: 6px;
}
.corner-ornament.tr {
  top: 6px;
  right: 6px;
  transform: rotate(90deg);
}
.corner-ornament.bl {
  bottom: 6px;
  left: 6px;
  transform: rotate(-90deg);
}
.corner-ornament.br {
  bottom: 6px;
  right: 6px;
  transform: rotate(180deg);
}

.back-link {
  position: absolute;
  top: 22px;
  left: 30px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--brown);
  font-size: 13px;
  letter-spacing: 2px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  padding: 4px 6px;
  transition: color 0.15s ease;
}

.back-link:hover {
  color: var(--cinnabar);
}

.back-arrow {
  font-size: 18px;
  line-height: 1;
}

.onboard-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin-top: 4px;
}

.head-line {
  width: 70px;
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

.title-block {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-family: 'STXingkai', 'Xingkai SC', 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  color: var(--ink-mid);
}

.title-year {
  font-size: 28px;
  letter-spacing: 6px;
  font-weight: 600;
}

.title-dot {
  font-size: 22px;
  color: var(--cinnabar);
  opacity: 0.8;
}

.title-theme {
  font-size: 24px;
  letter-spacing: 8px;
  font-weight: 600;
}

.onboard-sub {
  margin: -6px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-soft);
  letter-spacing: 5px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-mute);
  letter-spacing: 4px;
  margin-bottom: 10px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.label-mark {
  width: 4px;
  height: 14px;
  background: linear-gradient(to bottom, var(--cinnabar), var(--cinnabar-edge));
  border-radius: 1px;
}

.onboard-body {
  display: flex;
  gap: 36px;
  margin-top: 4px;
}

.onboard-left {
  flex: 0 0 330px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.name-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-frame {
  position: relative;
  padding: 3px;
  background: linear-gradient(to right, var(--brown), var(--brown-paler), var(--brown));
  border-radius: 2px;
}

.input-frame::before,
.input-frame::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(138, 109, 75, 0.3), transparent);
  pointer-events: none;
}

.input-frame::before {
  top: 8px;
}
.input-frame::after {
  bottom: 8px;
}

.name-input {
  width: 100%;
  background: var(--paper-input);
  border: none;
  border-radius: 1px;
  color: var(--ink);
  font-size: 15px;
  padding: 10px 14px;
  outline: none;
  letter-spacing: 3px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  box-shadow: inset 0 1px 3px rgba(90, 60, 20, 0.08);
}

.name-input:focus {
  background: var(--paper-hi);
}

.name-input::placeholder {
  color: var(--ink-muted);
  letter-spacing: 2px;
}

.name-error {
  color: var(--cinnabar);
  font-size: 12px;
  margin: 0;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.detail-panel {
  position: relative;
  border: 1px solid rgba(138, 109, 75, 0.35);
  background: var(--paper-panel);
  box-shadow: 0 2px 8px rgba(90, 60, 20, 0.06);
  display: flex;
  flex-direction: column;
  flex: 1;
}

.detail-panel.empty {
  justify-content: center;
  align-items: center;
  min-height: 220px;
}

.panel-scroll-cap,
.panel-scroll-foot {
  height: 10px;
  background: repeating-linear-gradient(
    90deg,
    var(--paper-faint) 0px,
    var(--paper-faint) 8px,
    var(--brown-paler) 8px,
    var(--brown-paler) 10px
  );
  opacity: 0.6;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 2px solid rgba(180, 150, 100, 0.4);
  font-size: 15px;
  color: var(--ink);
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  letter-spacing: 2px;
  background: linear-gradient(to right, var(--paper), transparent 70%);
}

.panel-seal {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(90, 60, 20, 0.15);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
}

.panel-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}

.panel-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}

.panel-key {
  color: var(--ink-soft);
  min-width: 36px;
  flex-shrink: 0;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.panel-val {
  color: var(--ink-mid);
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
}

.panel-sep {
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(138, 109, 75, 0.25), transparent);
  margin: 7px 0;
}

.panel-desc {
  margin: 0;
  font-size: 13px;
  color: var(--ink-deep);
  line-height: 1.85;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  text-align: justify;
}

.empty-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  color: var(--ink-muted);
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

.empty-body p {
  font-size: 13px;
  letter-spacing: 2px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  margin: 0;
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
  gap: 8px;
}

.faction-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.25);
  border-radius: 2px;
  cursor: pointer;
  color: var(--ink-mid);
  font-size: 14px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  letter-spacing: 1px;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
  position: relative;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.04);
}

.faction-card::before {
  content: '';
  position: absolute;
  inset: 2px 0;
  border-top: 1px dashed rgba(138, 109, 75, 0.12);
  border-bottom: 1px dashed rgba(138, 109, 75, 0.12);
  pointer-events: none;
}

.faction-card:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.45);
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(90, 60, 20, 0.08);
}

/* 按下即时反馈（Apple §1）：从悬停抬升回到下沉，明确"按下" */
.faction-card:active {
  transform: translateY(1px) scale(0.98);
  transition: transform 80ms ease-out;
}

.faction-card.selected {
  border-width: 1px;
  color: var(--ink-strong);
  font-weight: 600;
}

.card-seal {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  border-radius: 2px;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(90, 60, 20, 0.1);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
}

.card-name {
  position: relative;
  z-index: 1;
}

.enter-btn {
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 11px 42px;
  font-size: 18px;
  letter-spacing: 12px;
  color: #fff;
  background: linear-gradient(135deg, var(--cinnabar-bright) 0%, var(--cinnabar-deep) 100%);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-family: 'KaiTi', 'KaiTi_GB2312', 'SimSun', serif;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3px var(--cinnabar-deep),
    0 6px 14px rgba(120, 30, 20, 0.3);
  margin-top: 6px;
  position: relative;
  overflow: hidden;
}

.enter-btn:active:not(:disabled) {
  transform: translateY(1px) scale(0.97);
  transition: transform 80ms ease-out;
}

.enter-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.15), transparent 60%);
  pointer-events: none;
}

.enter-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--cinnabar-line) 0%, var(--cinnabar-deep2) 100%);
  transform: translateY(-1px);
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3px var(--cinnabar-deep2),
    0 8px 18px rgba(120, 30, 20, 0.35);
}

.enter-btn:disabled {
  background: linear-gradient(135deg, var(--brown-pale) 0%, var(--brown-soft) 100%);
  box-shadow:
    0 0 0 2px var(--paper),
    0 0 0 3px var(--brown-soft),
    0 4px 10px rgba(90, 60, 20, 0.1);
  color: var(--ink-faint);
  cursor: not-allowed;
}

.btn-text {
  position: relative;
  z-index: 1;
}
</style>
