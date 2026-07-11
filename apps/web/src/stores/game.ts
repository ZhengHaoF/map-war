import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { chinaCities } from '@/data/chinaCities'
import { Owner } from '@/data/owners'

// 战斗元数据（PixiJS 句柄不进 store，由 gameOrders 模块本地持有）
export interface BattleInfo {
  id: string
  from: string
  to: string
  fromName: string
  toName: string
  active: boolean
}

/**
 * 世界态快照 —— 供 AI 读取的「只读、脱离响应式」视图。
 * getSnapshot() 返回的是普通对象拷贝，序列化给 LLM 安全，
 * 且不会在调用方建立任何 Pinia 响应式依赖。
 */
export interface WorldStateSnapshot {
  /** 当前推演日期 */
  currentDate: string
  /** 玩家所选势力（未选为 null） */
  currentFaction: Owner | null
  /** 当前存活的势力列表 */
  activeFactions: Owner[]
  /** 城市归属表：gb 编码 -> 控制政权 */
  ownership: Record<string, Owner>
  /** 进行中的战斗元数据列表 */
  battles: BattleInfo[]
}

export const useGameStore = defineStore('game', () => {
  // ── 全局要用的变量（唯一真相源）──
  const ownership = reactive<Record<string, Owner>>(
    Object.fromEntries(
      chinaCities.filter((c) => c.gb).map((c) => [c.gb, (c.owner as Owner) ?? Owner.NEUTRAL]),
    ) as Record<string, Owner>,
  )
  const currentDate = ref('1931-01-01')
  const currentFaction = ref<Owner | null>(null)
  const playerName = ref('')
  const activeFactions = ref<Owner[]>([
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
  ])
  const battles = ref<BattleInfo[]>([])

  // ── 派生（不存）──
  const myCities = computed(() =>
    Object.entries(ownership)
      .filter(([, o]) => o === currentFaction.value)
      .map(([gb]) => gb),
  )
  const cityOwner = (gb: string): Owner | undefined => ownership[gb]
  const isAlive = (f: Owner): boolean => activeFactions.value.includes(f)
  const factionCities = (f: Owner): string[] =>
    Object.entries(ownership)
      .filter(([, o]) => o === f)
      .map(([gb]) => gb)

  // ── 初始化 / 设置 ──
  function initWorld(): void {
    for (const c of chinaCities) {
      if (!c.gb) continue
      ownership[c.gb] = (c.owner as Owner) ?? Owner.NEUTRAL
    }
    currentDate.value = '1931-09-18'
  }

  function selectFaction(f: Owner): void {
    currentFaction.value = f
  }

  function setPlayer(name: string, faction: Owner): void {
    playerName.value = name
    currentFaction.value = faction
  }

  /**
   * 读取世界态快照（非响应式副本）。
   * 用途：把当前局势一次性交给 AI 当只读上下文。
   * 所有字段均为拷贝，调用方对返回值的修改不会影响 store 本身。
   */
  function getSnapshot(): WorldStateSnapshot {
    return {
      currentDate: currentDate.value,
      currentFaction: currentFaction.value,
      activeFactions: [...activeFactions.value],
      ownership: { ...ownership },
      battles: battles.value.map((b) => ({ ...b })),
    }
  }

  return {
    ownership,
    currentDate,
    currentFaction,
    playerName,
    activeFactions,
    battles,
    myCities,
    cityOwner,
    isAlive,
    factionCities,
    initWorld,
    selectFaction,
    setPlayer,
    getSnapshot,
  }
})
