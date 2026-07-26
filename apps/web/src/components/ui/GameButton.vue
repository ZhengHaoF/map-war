<template>
  <button
    class="game-btn"
    :class="{ active, danger, parchment, 'is-loading': loading, 'is-small': size === 'small' }"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="game-btn__spinner" aria-hidden="true"></span>
    <slot />
    <span v-if="tooltip" class="game-btn__tip">{{ tooltip }}</span>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  active?: boolean
  danger?: boolean
  parchment?: boolean
  tooltip?: string
  loading?: boolean
  disabled?: boolean
  size?: 'small' | 'normal'
}>()

defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.game-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  white-space: nowrap;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  /* 只过渡可被合成器加速的属性，避免渐变背景重绘掉帧（Apple §11） */
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  backdrop-filter: blur(4px);
}

.game-btn__tip {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  background: var(--paper-deep, #2a1f10);
  color: var(--ink, #e8dcc0);
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--font-kai);
  letter-spacing: 1px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(60, 40, 15, 0.3);
}

.game-btn:hover .game-btn__tip {
  opacity: 1;
}

.game-btn :deep(svg) {
  display: block;
  flex-shrink: 0;
}

.game-btn:hover {
  background: rgba(0, 0, 0, 0.8);
  border-color: rgba(255, 255, 255, 0.5);
}

/* 按下即时反馈（Apple §1）：pointerdown 即缩放，不等 click 抬起 */
.game-btn:active {
  transform: scale(0.96);
  transition: transform 80ms ease-out;
}

/* 重染孤儿蓝（原 rgba(59,130,246)，与全站朱砂语义冲突）→ 改用游戏统一朱砂强调色，
   让所有激活态讲同一种语言；parchment 变体的 .active 仍走下方更深的纸面朱砂态 */
.game-btn.active {
  background: rgba(178, 58, 46, 0.85);
  border-color: rgba(178, 58, 46, 1);
  color: #fff;
}

.game-btn.danger:hover {
  background: rgba(244, 68, 68, 0.3);
  color: var(--danger-text);
}

/* 羊皮纸/古籍变体 */
.game-btn.parchment {
  border: 1px solid rgba(138, 109, 75, 0.35);
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  color: var(--ink);
  backdrop-filter: none;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.06);
  font-family: var(--font-kai);
  letter-spacing: 1px;
}

.game-btn.parchment:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.55);
  color: var(--ink-strong);
}

/* 羊皮纸变体按压：轻微下沉 + 收一点阴影，呼应纸面被按下的触感 */
.game-btn.parchment:active {
  transform: scale(0.97);
  box-shadow: 0 1px 1px rgba(90, 60, 20, 0.1);
  transition: transform 80ms ease-out;
}

.game-btn.parchment.active {
  background: linear-gradient(to bottom, var(--paper-dark), var(--paper-darkest));
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.game-btn.parchment.danger:hover {
  background: linear-gradient(to bottom, var(--danger-bg), var(--danger-bg2));
  border-color: var(--cinnabar);
  color: var(--danger-ink);
}

/* ===== loading / disabled / size 变体（纯增量，不改现有变体） ===== */
.game-btn__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(176, 74, 58, 0.28);
  border-top-color: var(--cinnabar);
  flex-shrink: 0;
  animation: btn-spin 0.8s linear infinite;
}

.game-btn.is-loading {
  cursor: wait;
}

/* loading 时隐藏 slot 里原有的图标，由 spinner 顶替 */
.game-btn.is-loading :deep(svg) {
  display: none;
}

.game-btn.is-small {
  padding: 4px 10px;
  font-size: 12px;
  gap: 4px;
}

.game-btn.is-small :deep(svg) {
  width: 14px;
  height: 14px;
}

.game-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.game-btn.parchment:disabled {
  background: linear-gradient(to bottom, var(--paper-darker), var(--paper-darkest));
  border-style: dashed;
  border-color: rgba(138, 109, 75, 0.4);
  color: var(--ink-muted);
}

@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .game-btn__spinner {
    animation-duration: 1.6s;
  }
}
</style>
