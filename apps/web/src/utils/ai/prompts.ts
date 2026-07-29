/**
 * AI Prompt 装配器 —— 自包含 AI 模块的公共 prompt 层。
 *
 * 原文件：src/utils/aiPromptBuilder.ts
 * 职责：
 * 1. buildSystemPrompt —— 选择核心 prompt 常量
 * 2. buildPlayerProfile —— 玩家身份信息
 * 3. buildMessages —— 组装最终 messages[]
 * 4. buildFactionSystemPrompt —— 政权专属 AI prompt
 * 5. buildBattleFlavorPrompt —— 战斗调味 AI prompt
 */
export {
  buildSystemPrompt,
  buildPlayerProfile,
  buildMessages,
  buildFactionSystemPrompt,
  buildBattleFlavorSummary,
  buildBattleContext,
} from '@/utils/aiPromptBuilder'

export type { AiKind } from '@/utils/aiPromptBuilder'
