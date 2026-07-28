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

  /**
   * 保存游戏到指定槽位。
   * slot 为 'auto' 时被自动存档专用，玩家不可手动覆盖 auto 槽。
   * 返回是否成功。
   */
  function saveGame(slot: string, label?: string): boolean {
    if (slot === 'auto') {
      pushToast({ icon: 'alert-triangle', tone: 'error', title: '保存失败', text: '自动存档槽不可手动覆盖' })
      return false
    }
    const ok = store.save(slot, { label })
    if (ok) {
      pushToast({ icon: 'device-floppy', tone: 'green', title: '保存成功', text: label || slot })
    } else {
      pushToast({ icon: 'alert-triangle', tone: 'error', title: '保存失败', text: '存储空间可能已满' })
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

  /** 生成新的存档槽位名（基于时间戳，保证不重复） */
  function newSlotName(): string {
    return `save_${Date.now().toString(36)}`
  }

  return { loadGame, saveGame, deleteGame, listGames, newSlotName }
}
