import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';
import { createLLMClient, getModel, getMissingEnv } from './llm.client';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    this.client = createLLMClient();
    this.model = getModel();
  }

  async chat(body: Record<string, unknown>) {
    if (!this.client) {
      const missing = getMissingEnv();
      throw new HttpException(
        {
          error: 'AI 服务未配置',
          detail: `缺少环境变量: ${missing.join(', ')}`,
          hint: '请在 apps/server/ 下创建 .env 文件，参考 .env.example 填写 DeepSeek API Key',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const payload = {
      ...body,
      model: body.model ?? this.model,
    };

    try {
      return await this.client.chat.completions.create(
        payload as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      );
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`LLM chat failed: ${msg}`);
      throw new HttpException(
        { error: 'AI 请求失败', detail: msg },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
