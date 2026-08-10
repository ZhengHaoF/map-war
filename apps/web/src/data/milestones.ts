/**
 * 里程碑（成就）谓词表 —— 声明式定义，判定纯函数。
 *
 * 所有里程碑都是「状态谓词」：基于当前世界态（ctx）判定，不依赖战斗过程历史，
 * 因此可随读档重放自动重建（dateAdvance 分支逐回合重跑判定，与 relations 同法）。
 *
 * 展示约定：
 * - tier 1 功业 / tier 2 霸业 / tier 3 帝业（印章墙分组）
 * - sealChar 为印章单字，达成后钤印于印章墙；未达成灰描虚框
 */

import { Owner } from '@/data/owners'
import { getProvinceTable } from '@/utils/chronicle'

/** 判定上下文：由 store 在 dateAdvance 分支组装（玩家势力视角） */
export interface MilestoneContext {
  faction: Owner
  /** 玩家当前城数 */
  cityCount: number
  /** 世界总城数（统一度分母） */
  totalCities: number
  /** 玩家累计占城数（capture 计数，重放自动重建） */
  captures: number
  /** 玩家各省占有城数（省码 → 数） */
  provinceOwned: Record<string, number>
  /** 玩家总兵力（k） */
  troops: number
  /** 玩家加权士气 0-100 */
  morale: number
  /** 银库（万银） */
  treasury: number
  /** 粮仓（万石） */
  granary: number
  /** 玩家胜仗总数 */
  victories: number
  /** 玩家会战胜场数（turns ≥ 3） */
  majorVictories: number
  /** 玩家鏖战胜场数（turns ≥ 5 或 歼敌 ≥ 10k） */
  bloodyVictories: number
}

export interface MilestoneDef {
  id: string
  title: string
  /** toast 副文案 */
  flavor: string
  /** 印章单字 */
  sealChar: string
  tier: 1 | 2 | 3
  check: (ctx: MilestoneContext) => boolean
}

/** 某省是否「全省在握」（世界该省总城数 > 0 时才生效，避免种子缺省误判） */
function wholeProvince(ctx: MilestoneContext, code: string): boolean {
  const table = getProvinceTable()
  const total = table[code]?.total ?? 0
  if (total === 0) return false
  return (ctx.provinceOwned[code] ?? 0) >= total
}

/** 收复东北：辽宁(21) / 吉林(22) / 黑龙江(23) 全省在握 */
function northeastReclaimed(ctx: MilestoneContext): boolean {
  return wholeProvince(ctx, '21') && wholeProvince(ctx, '22') && wholeProvince(ctx, '23')
}

export const MILESTONES: MilestoneDef[] = [
  // ── 功业（tier 1）：成长小节点 ──
  {
    id: 'first-capture',
    title: '初克一城',
    flavor: '兵锋所向，首拔城池',
    sealChar: '克',
    tier: 1,
    check: (ctx) => ctx.captures >= 1,
  },
  {
    id: 'first-victory',
    title: '胜绩初成',
    flavor: '兵芒初试，捷报频传',
    sealChar: '胜',
    tier: 1,
    check: (ctx) => ctx.victories >= 1,
  },
  {
    id: 'first-major-victory',
    title: '首胜会战',
    flavor: '阵云压垒，会战大捷',
    sealChar: '会',
    tier: 1,
    check: (ctx) => ctx.majorVictories >= 1,
  },
  {
    id: 'ten-cities',
    title: '十城之基',
    flavor: '十城连横，基业初成',
    sealChar: '基',
    tier: 1,
    check: (ctx) => ctx.captures >= 10,
  },
  {
    id: 'army-100k',
    title: '带甲十万',
    flavor: '十万雄师，声威赫赫',
    sealChar: '兵',
    tier: 1,
    check: (ctx) => ctx.troops >= 100,
  },
  {
    id: 'rich-treasury',
    title: '府库充盈',
    flavor: '仓廪殷实，钱粮无忧',
    sealChar: '盈',
    tier: 1,
    check: (ctx) => ctx.treasury >= 500,
  },
  // ── 霸业（tier 2）：区域 / 实力节点 ──
  {
    id: 'northeast',
    title: '收复东北',
    flavor: '白山黑水，尽归麾下',
    sealChar: '东',
    tier: 2,
    check: northeastReclaimed,
  },
  {
    id: 'bloody-battle',
    title: '鏖战决胜',
    flavor: '血战坚城，一役破敌',
    sealChar: '鏖',
    tier: 2,
    check: (ctx) => ctx.bloodyVictories >= 1,
  },
  {
    id: 'quarter-realm',
    title: '雄踞一方',
    flavor: '四分天下，已有其一',
    sealChar: '踞',
    tier: 2,
    check: (ctx) => ctx.cityCount >= ctx.totalCities * 0.25,
  },
  {
    id: 'well-supplied',
    title: '兵精粮足',
    flavor: '强兵足食，进可攻退可守',
    sealChar: '足',
    tier: 2,
    check: (ctx) => ctx.troops >= 80 && ctx.granary >= 300,
  },
  // ── 帝业（tier 3）：一统节点 ──
  {
    id: 'half-realm',
    title: '半壁江山',
    flavor: '半壁河山，大势已定',
    sealChar: '半',
    tier: 3,
    check: (ctx) => ctx.cityCount >= ctx.totalCities * 0.5,
  },
  {
    id: 'two-thirds',
    title: '三分天下有其二',
    flavor: '天命所归，指日可待',
    sealChar: '二',
    tier: 3,
    check: (ctx) => ctx.cityCount >= ctx.totalCities * (2 / 3),
  },
  {
    id: 'unification',
    title: '天下一统',
    flavor: '扫平群雄，一统江山',
    sealChar: '统',
    tier: 3,
    check: (ctx) => ctx.cityCount >= ctx.totalCities * 0.95,
  },
]

export const MILESTONE_TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: '功业',
  2: '霸业',
  3: '帝业',
}

/**
 * 纯函数：返回本次新解锁的里程碑 id 列表。
 * @param ctx      当前玩家势力视角的世界态
 * @param unlocked 已解锁记录（id → 时间戳记录），重复达成跳过
 */
export function evaluateMilestones(
  ctx: MilestoneContext,
  unlocked: Record<string, unknown>,
): string[] {
  const fresh: string[] = []
  for (const m of MILESTONES) {
    if (unlocked[m.id]) continue
    if (m.check(ctx)) fresh.push(m.id)
  }
  return fresh
}
