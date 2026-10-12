import { shallowRef, readonly } from 'vue'
import type { Owner } from '@/data/owners'

/**
 * 新局开场动画的一次性 UI 意图（非世界态）。
 *
 * - 只由择势页“开战”在 setPlayer() 成功之后显式发出；读档 / 重放 / god-mode 改势力都不经此处。
 * - 不进 game store、不进 eventLog、不进存档；地图侧消费一次即清空，同一意图不会播第二次。
 * - 地图侧绝不通过 watch(currentFaction) 推断“新局”，读档重放同样会写 currentFaction。
 */
export interface NewGameIntroRequest {
  /** 单调递增序号：同一局只消费一次 */
  nonce: number
  /** 发出意图时 store 里实际生效的势力，用于消费时校验未被替换 */
  faction: Owner
  /** 发出意图时 store.reloadToken，读档后令旧意图失效 */
  reloadToken: number
}

let nextNonce = 0
const pending = shallowRef<NewGameIntroRequest | null>(null)

/** 择势页调用：发出一次性开场意图。返回 nonce。 */
export function requestNewGameIntro(faction: Owner, reloadToken: number): number {
  nextNonce += 1
  pending.value = { nonce: nextNonce, faction, reloadToken }
  return nextNonce
}

/** 地图侧调用：取走并清空意图（一次性）。 */
export function takeNewGameIntro(): NewGameIntroRequest | null {
  const r = pending.value
  pending.value = null
  return r
}

/** 丢弃尚未消费的意图（读档 / 世界重置时调用，避免旧意图在后续误播）。 */
export function discardNewGameIntro(): void {
  pending.value = null
}

/** 只读视图：地图侧 watch 它的 nonce 以感知新意图。 */
export const pendingNewGameIntro = readonly(pending)
