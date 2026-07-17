import { useGameStore } from '@/stores/game'
import type { SaveMeta } from '@/stores/game'
import { useToast } from '@/composables/useToast'

/**
 * 存档读写的统一入口（供存档选择器等 UI 使用）。
 *
 * 关键点：store.load(slot) 只重建 store 状态并把 isReplaying 置为 true，
 * 它不会重绘地图、不会重建战斗动画、也不会复位 isReplaying——这些"收尾"
 * 由 LeafletMap 的 watch(reloadToken) 完成。因此读档必须调 loadGame()，
 * 它在 load 成功后触发 requestMapReload()，让地图组件接手收尾。
 */
export function useSaveGame() {
  const store = useGameStore()
  const { push: pushToast } = useToast()

  /** 读取某槽存档：重建状态 → 通知地图重绘收尾。返回是否成功。 */
  function loadGame(slot: string): boolean {
    const ok = store.load(slot)
    if (ok) {
      store.requestMapReload()
      pushToast({ icon: 'file-import', tone: 'green', title: '读档成功', text: '已载入存档' })
    } else {
      pushToast({ icon: 'alert-triangle', tone: 'error', title: '读档失败', text: '存档损坏或不存在' })
    }
    return ok
  }

  /** 删除某槽存档 */
  function deleteGame(slot: string): void {
    store.deleteSave(slot)
    pushToast({ icon: 'trash', tone: 'neutral', title: '已删除存档', text: slot })
  }

  /** 列出所有存档摘要，按保存时间倒序（最近的在前） */
  function listGames(): SaveMeta[] {
    return Object.values(store.listSaves()).sort((a, b) => b.savedAt - a.savedAt)
  }

  return { loadGame, deleteGame, listGames }
}
