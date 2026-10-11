import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { routesFrom } from '@/utils/campaignRoutes'
import { isInTruce, readRelation } from '@/utils/diplomacy'

export type MapCommandKind = 'battle' | 'moveTroops'
export interface MapCommandDraft {
  kind: MapCommandKind
  sourceGb: string
  targetGb: string
}
export type MapCommandPhase = 'idle' | 'pickingSource' | 'pickingTarget' | 'reviewing'
export const MAP_COMMAND_CANDIDATE_COLOR = 0xf6cc38

/** Selection is UI-only. It never submits orders or mutates world resources. */
export function useMapCommand() {
  const store = useGameStore()
  const phase = ref<MapCommandPhase>('idle')
  const draft = ref<MapCommandDraft>({ kind: 'battle', sourceGb: '', targetGb: '' })
  const error = ref('')
  const picking = computed(() => phase.value === 'pickingSource' || phase.value === 'pickingTarget')
  function cancel() {
    phase.value = 'idle'
    draft.value = { kind: 'battle', sourceGb: '', targetGb: '' }
    error.value = ''
  }
  function begin(kind: MapCommandKind) {
    if (!store.currentFaction) return false
    // Every new action starts at step one, even when a city was already selected.
    draft.value = { kind, sourceGb: '', targetGb: '' }
    phase.value = 'pickingSource'
    error.value = ''
    return true
  }
  function targetReason(gb: string): string {
    const { sourceGb, kind } = draft.value
    const actor = store.currentFaction
    const city = store.cities[gb]
    if (!actor || store.cities[sourceGb]?.owner !== actor) return '出发城已不可用，请重选己方出发城'
    if (!city) return '请选择市级城市'
    if (gb === sourceGb) return '目标不能与出发城相同'
    if (kind === 'moveTroops' && city.owner !== actor) return '调兵目标必须是己方城市'
    if (kind === 'battle' && city.owner === actor) return '进攻目标必须是非己方城市'
    if (!routesFrom(sourceGb, actor, store.cities).has(gb)) return '没有合法路线，途中只能经过己方城市'
    if (kind === 'battle') {
      if (isInTruce(store.relations, actor, city.owner, store.currentDate)) return '双方尚在停战期，不能开战'
      if (readRelation(store.relations, actor, city.owner).status === 'alliance') return '目标为同盟势力，请先解除同盟或宣战'
      if (store.battles.some(b => b.active && b.from === sourceGb)) return '同一来源城只能维持一条战线'
    }
    return ''
  }
  const candidates = computed(() => {
    const actor = store.currentFaction
    if (!actor || !picking.value) return []
    if (phase.value === 'pickingSource')
      return Object.values(store.cities).filter(c => c.owner === actor).map(c => c.gb)
    return [...routesFrom(draft.value.sourceGb, actor, store.cities).keys()]
      .filter(gb => !targetReason(gb))
  })
  function pick(gb: string) {
    if (!picking.value) return false
    if (phase.value === 'pickingSource') {
      if (!store.currentFaction || store.cities[gb]?.owner !== store.currentFaction) {
        error.value = '请选择己方出发城'
        return false
      }
      draft.value = { ...draft.value, sourceGb: gb, targetGb: '' }
      phase.value = 'pickingTarget'
    } else {
      error.value = targetReason(gb)
      if (error.value) return false
      draft.value = { ...draft.value, targetGb: gb }
      phase.value = 'reviewing'
    }
    error.value = ''
    return true
  }
  return { phase, draft, error, picking, candidates, begin, pick, cancel, targetReason }
}

export function isMapCommandShortcut(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null
  return !event.isComposing && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey
    && !el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
}
