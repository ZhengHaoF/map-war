import type { CityState } from '@/stores/game'
import { Owner } from '@/data/owners'
import { getSupplyStatus, occupationRemaining } from './supply'

export const SOUTHWEST_SCENARIO = 'southwest-bridgehead' as const
export const BRIDGEHEAD_GB = '156530600'
export const REAR_GB = '156511500'
export const HOLD_TURNS = 3
export interface ScenarioProgress {
  id: typeof SOUTHWEST_SCENARIO
  faction: Owner.SCC
  startedTurn: number
  holdTurns: number
  completedTurn?: number
}
export function bridgeheadConditions(cities: Record<string, CityState>, turn: number) {
  const target = cities[BRIDGEHEAD_GB]
  const rear = cities[REAR_GB]
  const targetOwned = target?.owner === Owner.SCC
  const rearOwned = rear?.owner === Owner.SCC
  const supply = getSupplyStatus(BRIDGEHEAD_GB, Owner.SCC, cities, turn)
  const remaining = target ? occupationRemaining(target, turn) : 0
  const integrated = !!target && remaining === 0
  return {
    targetOwned,
    rearOwned,
    supplied: supply.supplied,
    remaining,
    integrated,
    ready: targetOwned && rearOwned && supply.supplied && integrated,
  }
}
/** Checkpoint uses pre-date conditions: integration ending now is not a held turn. */
export function updateScenarioProgress(
  progress: ScenarioProgress,
  ready: boolean,
  completedTurn?: number,
): ScenarioProgress {
  if (progress.completedTurn !== undefined) return progress
  if (!ready) return { ...progress, holdTurns: 0 }
  if (completedTurn === undefined) return progress
  const holdTurns = Math.min(HOLD_TURNS, progress.holdTurns + 1)
  return {
    ...progress,
    holdTurns,
    completedTurn: holdTurns === HOLD_TURNS ? completedTurn : undefined,
  }
}
export function scenarioStatus(
  progress: ScenarioProgress,
  cities: Record<string, CityState>,
  turn: number,
) {
  const c = bridgeheadConditions(cities, turn)
  const completed = progress.completedTurn !== undefined
  const goal = completed
    ? '西南支点已稳固'
    : !c.targetOwned
      ? '夺取昭通'
      : !c.rearOwned
        ? '收复并守住宜宾'
        : !c.supplied
          ? '恢复昭通补给'
          : !c.integrated
            ? '等待昭通整合'
            : '连续守住支点'
  return {
    ...c,
    ...progress,
    completed,
    goal,
    steps: [
      {
        label: '夺取昭通',
        done: completed || c.targetOwned,
        detail: '占领只能由战斗或合法外交移交产生。',
      },
      {
        label: '整合并连通补给',
        done: completed || c.ready,
        detail: completed
          ? '达成时已完成整合并连通补给；完成记录保留。'
          : `保有宜宾；昭通整合剩余${c.remaining}回合；${c.supplied ? '补给通畅' : '补给未连通'}。`,
      },
      {
        label: '连续守住三个完整回合',
        done: completed,
        detail: completed
          ? `${progress.holdTurns}/${HOLD_TURNS} 回合；战役已完成，后续失地不清除完成记录。`
          : `${progress.holdTurns}/${HOLD_TURNS} 回合；失守、断供或整合未完成会清零。`,
      },
    ],
  }
}
