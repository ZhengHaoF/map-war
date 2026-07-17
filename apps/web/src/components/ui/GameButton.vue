<template>
  <button class="game-btn" :class="{ active, danger, parchment }" @click="$emit('click', $event)">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  active?: boolean
  danger?: boolean
  parchment?: boolean
}>()

defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<style scoped>
.game-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  white-space: nowrap;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
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
</style>
