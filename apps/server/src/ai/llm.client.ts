import OpenAI from 'openai';
import { Logger } from '@nestjs/common';

const REQUIRED_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

export type ReasoningEffort = 'low' | 'medium' | 'high';
const VALID_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

export function isLLMConfigured(): boolean {
  return REQUIRED_ENV.every(k => !!process.env[k]);
}

export function getMissingEnv(): string[] {
  return REQUIRED_ENV.filter(k => !process.env[k]);
}

/**
 * 推理强度（仅 Chat Completions API 生效，step-3.7-flash 支持 low/medium/high）。
 * 通过 .env 的 LLM_REASONING_EFFORT 配置，默认 low。
 * 请求体若携带 reasoning_effort 可临时覆盖该默认值。
 */
export function getReasoningEffort(): ReasoningEffort {
  const raw = (process.env.LLM_REASONING_EFFORT ?? 'low').toLowerCase();
  return (VALID_EFFORTS as readonly string[]).includes(raw)
    ? (raw as ReasoningEffort)
    : 'low';
}

export function createLLMClient(): OpenAI | null {
  if (!isLLMConfigured()) {
    const logger = new Logger('LLMClient');
    const missing = getMissingEnv();
    logger.warn(
      `AI 未配置，缺少环境变量: ${missing.join(', ')}。请复制 apps/server/.env.example 为 .env 并填写 API Key。POST /api/ai/chat 将不可用。`,
    );
    return null;
  }
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
    timeout: 5 * 60 * 1000, // 5 分钟超时
  });
}

export function getModel(): string {
  return process.env.LLM_MODEL ?? 'deepseek-chat';
}
