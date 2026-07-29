/**
 * AI 指令契约 —— 自包含 AI 模块的公共 prompt 常量层。
 *
 * 原文件：src/utils/aiOrderContract.ts
 * 这里只定义「AI 应该返回什么形状」+ 结构校验，不包含执行逻辑。
 */
export {
  CONTRACT_SCHEMA_TEXT,
  PLAYER_AI_UNIFIED_PROMPT,
  ADVISOR_SYSTEM_PROMPT,
} from '@/utils/aiOrderContract'

// 重新导出校验相关的类型和函数
export {
  validateOrders,
  validateFactionOrders,
  validateFactionOrder,
} from '@/utils/aiOrderContract'

export type {
  BatchValidation,
  StrategicRuleResult,
} from '@/utils/aiOrderContract'
