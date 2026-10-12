import OpenAI from 'openai';
import { Logger } from '@nestjs/common';
import { AiProxyConfig } from './ai-proxy.config';
import type { SanitizedChatParams } from './chat-request.schema';

export const AI_PROXY_CONFIG = 'AI_PROXY_CONFIG';
export const LLM_CLIENT = 'LLM_CLIENT';

export interface LlmRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

/** 代理实际使用到的上游接口子集（测试中用假实现替换，不调用真实模型） */
export interface LlmClientLike {
  chat: {
    completions: {
      create(params: SanitizedChatParams, options?: LlmRequestOptions): Promise<unknown>;
    };
  };
}

export function createLLMClient(cfg: AiProxyConfig, env: Record<string, string | undefined> = process.env): LlmClientLike | null {
  if (!cfg.llmConfigured) {
    new Logger('LLMClient').warn(
      `AI 未配置，缺少环境变量: ${cfg.missingEnv.join(', ')}。请复制 apps/server/.env.example 为 .env 并填写 API Key。POST /api/ai/chat 将不可用。`,
    );
    return null;
  }
  const client = new OpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
    // 显式设置：默认 SDK 为 10 分钟 + 2 次重试，会与前端 3 次重试叠加放大成本
    timeout: cfg.upstreamTimeoutMs,
    maxRetries: cfg.upstreamMaxRetries,
  });
  return client as unknown as LlmClientLike;
}
