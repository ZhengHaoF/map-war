<template>
  <Teleport to="body">
    <div class="toast-stack">
      <TransitionGroup name="toast">
        <GameToast
          v-for="t in toasts"
          :key="t.id"
          :toast="t"
          @dismiss="dismiss"
        />
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import GameToast from '@/components/ui/GameToast.vue'

const { toasts, dismiss } = useToast()
</script>

<style scoped>
.toast-stack {
  position: fixed;
  /* 顶部居中、日期条（top:16px）正下方，往下叠；避开右侧 HUD 与左上图层器 */
  top: 120px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 容器不拦截点击，仅卡片本身可点（卡片在 GameToast 内 pointer-events:auto） */
  pointer-events: none;
}

/* 入场：自顶部下滑 + 淡入；出场：向右淡出 */
.toast-enter-from {
  opacity: 0;
  transform: translateY(-14px);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(28px);
}
/* 列表重排时的平滑位移 */
.toast-move {
  transition: transform 0.28s ease;
}
</style>
