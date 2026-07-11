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

  // ── 聚焦请求（面板 → 地图联动）──
  const focusTarget = ref<{ type: 'city' | 'battle'; id: string } | null>(null)
  function requestFocus(type: 'city' | 'battle', id: string): void {
    focusTarget.value = { type, id }
  }

  // ── 我方聚合（派生，不存）──
  interface MyCityStat {
    gb: string
    name: string
    cityLevel: number
    industry: number
    food: number
    fort: number
  }
  interface MyStats {
    cityCount: number
    totalIndustry: number
    totalFood: number
    avgFort: number
    levelDistribution: Record<number, number>
    cities: MyCityStat[]
  }
  const myStats = computed<MyStats>(() => {
    const f = currentFaction.value
    const cities: MyCityStat[] = []
    if (f) {
      for (const [gb, o] of Object.entries(ownership)) {
        if (o !== f) continue
        const c = chinaCities.find((x) => x.gb === gb)
        cities.push({
          gb,
          name: c?.name ?? gb,
          cityLevel: c?.cityLevel ?? 0,
          industry: c?.industry ?? 0,
          food: c?.food ?? 0,
          fort: c?.fort ?? 0,
        })
      }
      cities.sort((a, b) => b.cityLevel - a.cityLevel || a.name.localeCompare(b.name))
    }
    const totalIndustry = cities.reduce((s, c) => s + c.industry, 0)
    const totalFood = cities.reduce((s, c) => s + c.food, 0)
    const avgFort = cities.length
      ? Math.round((cities.reduce((s, c) => s + c.fort, 0) / cities.length) * 10) / 10
      : 0
    const levelDistribution: Record<number, number> = {}
    for (const c of cities) {
      levelDistribution[c.cityLevel] = (levelDistribution[c.cityLevel] ?? 0) + 1
    }
    return { cityCount: cities.length, totalIndustry, totalFood, avgFort, levelDistribution, cities }
  })

  const myBattles = computed(() => {
    const f = currentFaction.value
    if (!f) return []
    return battles.value.filter((b) => {
      const oFrom = b.from ? ownership[b.from] : undefined
      const oTo = b.to ? ownership[b.to] : undefined
      return oFrom === f || oTo === f
    })
  })

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
    focusTarget,
    requestFocus,
    myStats,
    myBattles,
    initWorld,
    selectFaction,
    setPlayer,
    getSnapshot,
  }
})
