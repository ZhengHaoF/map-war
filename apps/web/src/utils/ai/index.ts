/**
 * AI 模块统一入口。
 *
 * 调用方只需 `import { xxx } from '@/utils/ai'`。
 * 公共层（contract / context / prompts / invoke / client）供 AI 模块内部使用。
 */

// ── AI 模块：内核 AI ──
export { decideFaction } from './factionAi'
export type { FactionDecision } from './factionAi'

export { runWorldBatch, runWorldSettle } from './worldAi'
export type { WorldSettleResult, WorldBatchResult } from './worldAi'

export { flavorBattles } from './battleFlavorAi'
export {
  CONTRACT_SCHEMA_TEXT,
  PLAYER_AI_UNIFIED_PROMPT,
  ADVISOR_SYSTEM_PROMPT,
  validateOrders,
  validateFactionOrders,
  validateFactionOrder,
} from './contract'
export type { BatchValidation, StrategicRuleResult } from './contract'

export { callLlm } from './client'
export type { LlmCallOpts } from './client'

export {
  buildFactionContext,
  buildMinorContext,
  buildWorldOverview,
  buildSettleContext,
  buildEventHistory,
} from './context'
export type { HistoryMode } from './context'

export {
  buildSystemPrompt,
  buildPlayerProfile,
  buildMessages,
  buildFactionSystemPrompt,
  buildBattleFlavorSummary,
  buildBattleContext,
} from './prompts'
export type { AiKind } from './prompts'

export { invokeAgentDecision } from './invoke'
export type { InvokeAgentDecisionOpts, InvokeAgentDecisionResult } from './invoke'

// ── AI 模块：场景 AI ──
export { judgeRetreat } from './retreatAi'
export type { RetreatOpts, RetreatResult } from './retreatAi'

export { negotiatePeace } from './peaceAi'
export type { PeaceOpts, PeaceResult } from './peaceAi'

export { sendTelegram } from './telegramAi'
export type { TelegramReply, TelegramOpts } from './telegramAi'
