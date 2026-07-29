/**
 * AI 上下文构建 —— 自包含 AI 模块的公共上下文层。
 *
 * 原文件：src/utils/aiContext.ts + src/utils/aiHistory.ts
 * 职责：
 * 1. buildFactionContext —— 政权决策上下文
 * 2. buildMinorContext —— 次要势力批量上下文
 * 3. buildWorldOverview —— 世界全景
 * 4. buildSettleContext —— P4 结算上下文
 * 5. buildEventHistory —— 历史事件时间线
 */
export {
  buildFactionContext,
  buildMinorContext,
  buildWorldOverview,
  buildSettleContext,
  TERRAIN_LABEL,
} from '@/utils/aiContext'

export {
  buildEventHistory,
} from '@/utils/aiHistory'

export type {
  HistoryMode,
  BuildHistoryOpts,
} from '@/utils/aiHistory'
