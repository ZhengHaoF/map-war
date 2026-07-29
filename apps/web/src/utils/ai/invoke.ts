/**
 * AI 决策通用包装器 —— 自包含 AI 模块的公共调用层。
 *
 * 原文件：src/utils/aiInvoke.ts（invokeAgentDecision 部分）
 * 设计：
 * - 调 callLlm（重试策略在 client.ts）
 * - 解析失败不重试（同 prompt 大概率同结果）
 * - 战略校验不在此处（由调用方做）
 */
export { invokeAgentDecision } from '@/utils/aiInvoke'
export type { InvokeAgentDecisionOpts, InvokeAgentDecisionResult } from '@/utils/aiInvoke'
