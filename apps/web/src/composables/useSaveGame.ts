import { useGameStore } from '@/stores/game'
import type { SaveMeta } from '@/stores/game'
import { useToast } from '@/composables/useToast'
import { useAgentKernel } from '@/composables/useAgentKernel'
import { useGameScheduler } from '@/composables/useGameScheduler'
import { aiEffectsPending } from '@/composables/useAiChat'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'

/**
 * 存档读写的统一入口（供存档选择器等 UI 使用）。
 *
 * store.load(slot) 独立重建并完成重放；地图 watcher 仅负责重绘和战斗动画。
 * loadGame() 还恢复暂停回合，并使旧 AI / 外交回复失效。
 */
export function useSaveGame() {
  const store = useGameStore()
  const { push: pushToast } = useToast()

  /** 读取某槽存档：重建状态 → 通知地图重绘收尾。返回是否成功。 */
  function loadGame(slot: string): boolean {
    const kernel = useAgentKernel()
    const scheduler = useGameScheduler()
    if (kernel.loading.value || scheduler.status.value === 'running'
      || aiEffectsPending.value > 0) {
      pushToast({ icon: 'alert-triangle', tone: 'amber', title: '暂不能读档',
        text: '世界回合或已接受的行动正在结算，请结束后再读取。等待中的玩家／顾问回复可通过读档作废。' })
      return false
    }
    const ok = store.load(slot)
    if (ok) {
      scheduler.queue.value = []
      scheduler.stoppedAt.value = null
      scheduler.executionResults.value = []
      scheduler.status.value = 'idle'
      kernel.turnSummary.value = null
      kernel.turnSummaryOwnership.value = {}
      kernel.lastError.value = ''
      kernel.phase.value = 'idle'
      kernel.progress.value = ''
      kernel.resetWaitProgress()
      store.requestMapReload()
      kernel.importPendingTurn(store.loadedPendingTurn)
      useDiplomacyBus().recoverSession()
      pushToast({ icon: 'file-import', tone: 'green', title: '读档成功',
        text: '已载入存档；旧对话、建议与草稿已清空，等待中的回复已作废。' })
      // 存档停在决策点上（eventLog 末尾是 pauseForPlayer）→ 补一句提示，避免玩家错过拍板时机
      if (store.pausedForPlayer) {
        pushToast({ icon: 'alert-triangle', tone: 'cinnabar', title: '请主公定夺', text: '局势有变，控制权已交还' })
      }
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
    if (useAgentKernel().loading.value || useGameScheduler().status.value === 'running'
      || aiEffectsPending.value > 0) {
      pushToast({ icon: 'alert-triangle', tone: 'amber', title: '暂不能保存',
        text: '世界回合或已接受的行动正在结算，请结束后再保存，避免保存半个回合。' })
      return false
    }
    if (slot === 'auto') {
      pushToast({ icon: 'alert-triangle', tone: 'error', title: '保存失败', text: '自动存档槽不可手动覆盖' })
      return false
    }
    const ok = store.save(slot, { label, pendingTurn: useAgentKernel().exportPendingTurn() })
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
