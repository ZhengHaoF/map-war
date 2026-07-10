import OpenAI from 'openai';

const REQUIRED_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

function assertEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }
}

export function createLLMClient(): OpenAI {
  assertEnv();
  return new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL,
  });
}

export function getModel(): string {
  return process.env.LLM_MODEL ?? 'deepseek-chat';
}
