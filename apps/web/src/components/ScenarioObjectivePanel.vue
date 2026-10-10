<template>
  <GameModal
    :visible="visible"
    title="西南战役 · 目标链"
    width="420px"
    variant="parchment"
    :z-index="2200"
    :overlay="false"
    @close="$emit('close')"
  >
    <section class="scenario-panel">
      <p>川军示范战役：以昭通为支点，先站稳，再谋扩张。</p>
      <template v-if="status">
        <div class="scenario-goal" role="status">{{ status.goal }}</div>
        <ol class="scenario-steps">
          <li v-for="step in status.steps" :key="step.label" :class="{ done: step.done }">
            <span>{{ step.done ? '已达成' : '待完成' }}</span>
            <strong>{{ step.label }}</strong>
            <small>{{ step.detail }}</small>
          </li>
        </ol>
        <p v-if="status.completed" class="scenario-complete">
          战役完成。完成记录保留，你仍可继续全国沙盘。
        </p>
        <p v-else>整合结束后的完整回合才计入守住进度；读档会恢复已有进度。</p>
      </template>
      <template v-else>
        <ol class="scenario-intro">
          <li>夺取昭通</li>
          <li>完成整合，保有宜宾并连通补给</li>
          <li>再连续守住三个完整回合</li>
        </ol>
        <GameButton parchment :disabled="store.currentFaction !== Owner.SCC" @click="start"
          >开始西南战役</GameButton
        >
      </template>
      <small
        >可选目标，不改变全国胜负，不发额外银粮；已有存档也可开始，守住进度从开始后计算。</small
      >
    </section>
  </GameModal>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { Owner } from '@/data/owners'
import { SOUTHWEST_SCENARIO } from '@/utils/scenarioObjective'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()
const store = useGameStore()
const status = computed(() => store.scenarioStatus)
function start() {
  store.applyEvent({ type: 'scenarioStarted', id: SOUTHWEST_SCENARIO, faction: Owner.SCC })
}
</script>
<style scoped>
.scenario-panel {
  padding: 16px;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.6;
  max-height: 70vh;
  overflow-y: auto;
}
.scenario-panel p {
  margin: 0 0 12px;
}
.scenario-panel > small {
  display: block;
  margin-top: 12px;
  color: var(--ink-soft);
}
.scenario-goal {
  padding: 8px 10px;
  background: var(--paper);
  border: 1px solid var(--line-soft);
  font-family: var(--font-song);
}
.scenario-steps {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  display: grid;
  gap: 12px;
}
.scenario-steps li {
  padding: 10px;
  border-left: 3px solid var(--cinnabar);
  background: var(--paper);
}
.scenario-steps li.done {
  border-left-color: #5a7a6a;
}
.scenario-steps span {
  font-size: 11px;
  color: var(--ink-soft);
  margin-right: 8px;
}
.scenario-steps strong {
  font-weight: 600;
}
.scenario-steps small {
  display: block;
  color: var(--ink-soft);
  margin-top: 4px;
}
.scenario-intro {
  padding-left: 22px;
  margin: 0 0 16px;
}
.scenario-complete {
  color: #45604e;
}
</style>
