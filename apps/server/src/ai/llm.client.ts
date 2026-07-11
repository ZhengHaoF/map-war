import OpenAI from 'openai';
import { Logger } from '@nestjs/common';

const REQUIRED_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

export function isLLMConfigured(): boolean {
  return REQUIRED_ENV.every(k => !!process.env[k]);
}

export function getMissingEnv(): string[] {
  return REQUIRED_ENV.filter(k => !process.env[k]);
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
  });
}

export function getModel(): string {
  return process.env.LLM_MODEL ?? 'deepseek-chat';
}
