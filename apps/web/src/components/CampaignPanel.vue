<template>
  <GameModal
    :visible="visible"
    title="前线 · 行军预览"
    width="540px"
    variant="parchment"
    draggable
    :cascade-offset="false"
    :init-x="180"
    :init-y="100"
    :overlay="false"
    @close="$emit('close')"
  >
    <div class="campaign-panel">
      <p class="campaign-rule">途中仅可经过己方城市，敌方只能作为进攻终点。海路仅限指定航线。</p>
      <div v-if="!store.currentFaction" class="campaign-empty">请先选择势力。</div>
      <template v-else>
        <div class="campaign-controls">
          <label
            >出发城
            <select v-model="sourceGb" aria-label="行军出发城">
              <option v-for="city in friendlyCities" :key="city.gb" :value="city.gb">
                {{ cityName(city.gb) }} · 驻{{ city.troops }}k
              </option>
            </select>
          </label>
          <label
            >行动
            <select v-model="kind" aria-label="行军类型">
              <option value="battle">进攻</option>
              <option value="moveTroops">调兵</option>
            </select>
          </label>
          <label
            >{{ kind === 'battle' ? '新增出兵（k）' : '调出兵力（k）' }}
            <input
              v-model.number="amount"
              aria-label="行军兵力"
              type="number"
              :min="kind === 'battle' && (source?.fieldForce ?? 0) > 0 ? 0 : 0.1"
              step="0.1"
              :max="source?.troops ?? 0"
            />
          </label>
        </div>
        <small v-if="kind === 'battle' && (source?.fieldForce ?? 0) > 0"
          >已有外出部队 {{ source?.fieldForce }}k；新增出兵填 0 可仅使用这些部队。</small
        >
        <label class="campaign-target"
          >目标城（可查询任何目标）
          <select v-model="targetGb" aria-label="行军目标城">
            <option value="">选择目标，查看路线与限制</option>
            <option v-for="city in targetCities" :key="city.gb" :value="city.gb">
              {{ cityName(city.gb) }} · {{ ownerLabel(city.owner) }}
            </option>
          </select>
        </label>
        <div
          v-if="preview"
          class="campaign-preview"
          :class="{ blocked: !preview.ok }"
          role="status"
          aria-live="polite"
        >
          <div class="campaign-verdict">
            {{ preview.ok ? '可执行' : '不可执行' }} · 回合行动点 {{ points }}
          </div>
          <p v-if="!preview.ok" class="campaign-reason">{{ preview.reason }}</p>
          <template v-if="preview.route">
            <p
              v-if="preview.supply"
              class="campaign-supply"
              :class="{ warning: !preview.supply.supplied }"
            >
              {{
                preview.supply.supplied
                  ? `补给通畅 · ${cityName(preview.supply.hubGb!)}`
                  : SUPPLY_PENALTY_LABEL
              }}
            </p>
            <p v-if="targetOccupation > 0" class="campaign-integration">
              目标城市整合中 · 剩余 {{ targetOccupation }} 回合，{{ OCCUPATION_YIELD_LABEL }}。
            </p>
            <p class="campaign-route">{{ preview.route.path.map(cityName).join(' → ') }}</p>
            <div class="campaign-cost">
              <span
                >{{ preview.route.seaLegs ? '含海路' : '陆路' }} ·
                {{ round(preview.route.distanceKm) }} km</span
              >
              <span>银 {{ preview.silver }} 万 · 粮 {{ preview.food }} 万石</span>
              <span
                >{{ kind === 'battle' ? '参战' : '调动' }} {{ preview.fightingTroops }}k · 消耗 1
                行动点</span
              >
            </div>
            <small v-if="preview.route.seaLegs"
              >海路段按
              {{ SEA_ROUTE_COST_MULTIPLIER }} 倍距离计行军成本，已包含在银粮预览中。</small
            >
            <section v-if="tactics" class="campaign-tactics" aria-label="战术权衡">
              <h4>战术权衡 · {{ tactics.label }}</h4>
              <p>
                下一轮基础估计：攻损 {{ tactics.attackerLoss }}k / 守损
                {{ tactics.defenderLoss }}k。
              </p>
              <p>
                来源留守 {{ tactics.remainingGarrison }}k；攻方士气
                {{ tactics.attackerMoraleBefore }} → {{ tactics.attackerMoraleAfter }} /
                守方士气 {{ tactics.defenderMoraleBefore }} → {{ tactics.defenderMoraleAfter }}。
              </p>
              <p>{{ moraleRuleText() }}</p>
              <ul>
                <li v-for="reason in tactics.reasons" :key="reason">{{ reason }}</li>
              </ul>
              <small
                >仅按当前状态作基础比较，不含后续行动、经济减员、突发事件或崩溃结果，不是胜率。风险提示不改变合法性与费用。</small
              >
            </section>
          </template>
        </div>
        <div v-if="result" class="campaign-result" :class="{ failed: !result.ok }" role="status">
          {{ result.text }}
        </div>
        <template v-if="kind === 'battle'">
          <div class="campaign-list-heading">
            当前可进攻目标 <span>{{ attackable.length }} 个</span>
          </div>
          <div v-if="!attackable.length" class="campaign-empty">
            暂无可执行进攻。可选择任意目标查看原因，或先整备、调兵、结束回合。
          </div>
          <div v-else class="campaign-target-list">
            <button
              v-for="item in attackable"
              :key="item.targetGb"
              class="campaign-target-row"
              :class="{ selected: targetGb === item.targetGb }"
              @click="targetGb = item.targetGb"
            >
              <span
                >{{ cityName(item.targetGb) }}
                <small
                  >{{ ownerLabel(store.cities[item.targetGb]!.owner) }} · 守{{
                    store.cities[item.targetGb]!.troops
                  }}k</small
                ></span
              >
              <span
                >银{{ item.silver }} / 粮{{ item.food
                }}<small
                  >{{ item.route?.seaLegs ? '海路' : '陆路' }} ·
                  {{ round(item.route?.distanceKm ?? 0) }} km</small
                ></span
              >
            </button>
          </div>
        </template>
      </template>
    </div>
    <div class="campaign-confirm">
      <GameButton v-if="store.currentFaction && preview" parchment :disabled="!preview.ok || busy || result?.ok" @click="executePreview">
        {{ busy ? '执行中…' : result?.ok ? '已执行，请重新选择' : kind === 'battle' ? '确认进攻' : '确认调兵' }}
      </GameButton>
      <GameButton parchment @click="$emit('close')">取消</GameButton>
    </div>
  </GameModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GameModal from '@/components/ui/GameModal.vue'
import GameButton from '@/components/ui/GameButton.vue'
import { useGameStore } from '@/stores/game'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { Owner, OWNER_LABELS } from '@/data/owners'
import { SEA_ROUTE_COST_MULTIPLIER } from '@/data/gameConfig'
import { getDisplayName } from '@/data/displayNames'
import { previewCampaign, getAttackableTargets } from '@/utils/campaignPreview'
import { occupationRemaining, SUPPLY_PENALTY_LABEL, OCCUPATION_YIELD_LABEL } from '@/utils/supply'
import { assessCampaign, moraleRuleText } from '@/utils/tacticalAssessment'
import type { MapCommandDraft } from '@/composables/useMapCommand'
import { aiRequestsPending } from '@/composables/useAiChat'

const props = defineProps<{ visible: boolean; initialSourceGb?: string | null; initialDraft?: MapCommandDraft | null }>()
defineEmits<{ close: [] }>()
const store = useGameStore()
const scheduler = useGameScheduler()
const kernel = useAgentKernel()
const sourceGb = ref('')
const targetGb = ref('')
const amount = ref(1)
const kind = ref<'battle' | 'moveTroops'>('battle')
const executing = ref(false)
const result = ref<{ ok: boolean; text: string } | null>(null)
const friendlyCities = computed(() =>
  Object.values(store.cities)
    .filter((c) => c.owner === store.currentFaction)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
)
const source = computed(() => store.cities[sourceGb.value])
const targetCities = computed(() =>
  Object.values(store.cities)
    .filter(
      (c) =>
        c.gb !== sourceGb.value &&
        (kind.value === 'battle'
          ? c.owner !== store.currentFaction
          : c.owner === store.currentFaction),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
)
const preview = computed(() =>
  targetGb.value ? previewCampaign(sourceGb.value, targetGb.value, amount.value, kind.value) : null,
)
const attackable = computed(() =>
  kind.value === 'battle' && props.visible
    ? getAttackableTargets(sourceGb.value, amount.value)
    : [],
)
const tactics = computed(() => (preview.value ? assessCampaign(preview.value) : null))
const points = computed(() =>
  store.currentFaction ? store.getActionPoints(store.currentFaction) : 0,
)
const targetOccupation = computed(() =>
  store.cities[targetGb.value]
    ? occupationRemaining(store.cities[targetGb.value]!, store.turnCount)
    : 0,
)
const busy = computed(
  () => executing.value || scheduler.status.value === 'running' || scheduler.queue.value.length > 0 || kernel.loading.value || aiRequestsPending.value > 0 || store.isReplaying,
)
const cityName = (gb: string) => getDisplayName(gb) || store.cities[gb]?.name || gb
const ownerLabel = (owner: Owner) => OWNER_LABELS[owner] ?? owner
const round = (v: number) => Math.round(v)
watch(
  [() => props.visible, () => props.initialSourceGb, () => props.initialDraft, () => store.currentFaction],
  () => {
    if (!props.visible) return
    const initial = props.initialDraft?.sourceGb ?? props.initialSourceGb
    if (initial && store.cities[initial]?.owner === store.currentFaction) sourceGb.value = initial
    else if (!sourceGb.value || store.cities[sourceGb.value]?.owner !== store.currentFaction)
      sourceGb.value = friendlyCities.value[0]?.gb ?? ''
    kind.value = props.initialDraft?.kind ?? 'battle'
    targetGb.value = props.initialDraft?.targetGb ?? ''
    amount.value = Math.min(1, source.value?.troops ?? 0)
    result.value = null
  },
  { immediate: true },
)
watch([sourceGb, kind], () => {
  targetGb.value = ''
  result.value = null
  amount.value = Math.min(1, source.value?.troops ?? 0)
}, { flush: 'sync' })
watch([targetGb, amount], () => { result.value = null }, { flush: 'sync' })
async function executePreview() {
  if (!preview.value?.ok || busy.value || result.value?.ok) return
  const order = { ...preview.value.order }
  executing.value = true
  result.value = null
  try {
    // The scheduler rechecks the latest state before executing; no bypass authority.
    scheduler.submit([order])
    await scheduler.advance()
    const outcome = scheduler.executionResults.value.find(
      (r) =>
        r.order === order ||
        (r.order.from === order.from && r.order.to === order.to && r.order.order === order.order),
    )
    result.value = {
      ok: !!outcome?.ok,
      text: outcome?.ok
        ? `${cityName(order.from!)} → ${cityName(order.to!)}：已执行${outcome.cost ? `（本次银${outcome.cost.silver}万、粮${outcome.cost.food}万石）` : ''}`
        : `未执行：${outcome?.reason ?? '队列未完成'}`,
    }
  } catch {
    result.value = { ok: false, text: '执行异常，未完成；请检查事件日志后重试。' }
  } finally {
    executing.value = false
  }
}
</script>

<style scoped>
.campaign-panel {
  padding: 14px;
  box-sizing: border-box;
  max-height: calc(100dvh - 260px);
  overflow-y: auto;
  color: var(--ink);
  font-size: 13px;
}
.campaign-confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--brown-line);
  background: var(--paper-deep);
}
@media (max-width: 600px) {
  .campaign-panel { max-height: calc(100dvh - 180px); }
}
.campaign-rule {
  margin: 0 0 12px;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.6;
}
.campaign-controls {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 8px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
select,
input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--brown-line);
  border-radius: 3px;
  color: var(--ink);
  background: var(--paper-input);
  font: inherit;
}
select:focus,
input:focus {
  outline: 2px solid var(--cinnabar);
  outline-offset: 1px;
}
.campaign-target {
  margin-top: 12px;
}
.campaign-preview {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--brown-line);
  background: var(--paper-hi);
}
.campaign-preview.blocked {
  border-color: var(--cinnabar);
}
.campaign-tactics {
  margin: 10px 0;
  padding: 10px;
  border: 1px solid var(--brown-line);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.campaign-tactics h4 {
  margin: 0 0 6px;
  color: var(--ink);
  font-size: 13px;
}
.campaign-tactics p {
  margin: 5px 0;
}
.campaign-tactics ul {
  padding-left: 18px;
  margin: 6px 0;
}
.campaign-verdict {
  font-weight: 600;
}
.campaign-reason {
  color: var(--cinnabar);
}
.campaign-supply,
.campaign-integration {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-soft);
}
.campaign-supply.warning {
  color: var(--cinnabar);
}
.campaign-route {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.campaign-cost {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-bottom: 8px;
}
.campaign-preview > small {
  display: block;
  margin-bottom: 10px;
  line-height: 1.5;
  color: var(--ink-soft);
}
.campaign-list-heading {
  margin: 16px 0 8px;
  display: flex;
  justify-content: space-between;
}
.campaign-list-heading span,
.campaign-empty {
  color: var(--ink-soft);
}
.campaign-empty {
  line-height: 1.7;
  padding: 8px 0;
}
.campaign-target-list {
  max-height: 230px;
  overflow-y: auto;
}
.campaign-target-row {
  width: 100%;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  text-align: left;
  padding: 10px;
  border: 1px solid var(--brown-line);
  background: var(--paper-panel);
  color: var(--ink);
  margin-bottom: 6px;
  cursor: pointer;
  font: inherit;
}
.campaign-target-row.selected,
.campaign-target-row:hover {
  border-color: var(--cinnabar);
  background: var(--paper-hi);
}
.campaign-target-row small {
  display: block;
  margin-top: 4px;
  color: var(--ink-soft);
  font-size: 11px;
}
.campaign-target-row > span:last-child {
  text-align: right;
  white-space: nowrap;
}
.campaign-result {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--brown-line);
}
.campaign-result.failed {
  color: var(--cinnabar);
}
@media (max-width: 600px) {
  .campaign-controls {
    grid-template-columns: 1fr 1fr;
  }
  .campaign-controls > label:first-child {
    grid-column: 1 / -1;
  }
}
</style>
