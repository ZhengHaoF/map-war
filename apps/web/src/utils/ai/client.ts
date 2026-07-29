/**
 * LLM 底层调用客户端 —— 自包含 AI 模块的公共 HTTP 层。
 *
 * 原文件：src/composables/useLlmClient.ts
 * 重试策略：网络/5xx 退避重试，4xx 抛错，JSON 解析失败抛错。
 */
export { callLlm } from '@/composables/useLlmClient'
export type { LlmCallOpts } from '@/composables/useLlmClient'
