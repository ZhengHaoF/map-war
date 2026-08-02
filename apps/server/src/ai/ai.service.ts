import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';
import { createLLMClient, getModel, getMissingEnv, getReasoningEffort } from './llm.client';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    this.client = createLLMClient();
    this.model = getModel();
  }

  /** AI 健康检查：发送简单问候，验证 LLM 连通性 */
  async healthCheck(): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
    if (!this.client) {
      const missing = getMissingEnv();
      return { ok: false, model: this.model, latencyMs: 0, error: `AI 服务未配置，缺少: ${missing.join(', ')}` };
    }

    const start = Date.now();
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: '你好，请回复 "ok"（纯文本即可）' }],
        max_tokens: 64,
      });
      const latencyMs = Date.now() - start;
      this.logger.log(`AI healthCheck raw response: ${JSON.stringify(res, null, 2)}`);
      const reply = res.choices?.[0]?.message?.content ?? '';
      return { ok: true, model: this.model, latencyMs, error: reply ? undefined : 'AI 返回为空' };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const msg = (err as Error).message;
      this.logger.error(`AI health check failed: ${msg}`);
      return { ok: false, model: this.model, latencyMs, error: msg };
    }
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
      reasoning_effort: (body.reasoning_effort as string | undefined) ?? getReasoningEffort(),
    };

    // 调试日志：打印请求关键信息，便于定位 prompt 问题
    const msgs = (body.messages as Array<{ role: string; content: string }> | undefined) ?? [];
    this.logger.log(`AI chat request: model=${body.model ?? this.model}, messages=${msgs.length}, response_format=${JSON.stringify(body.response_format)}`);
    for (let i = 0; i < msgs.length; i++) {
      this.logger.log(`  msg[${i}] role=${msgs[i].role}, content_len=${msgs[i].content?.length ?? 0}, has_json=${/json/i.test(msgs[i].content ?? '')}`);
    }

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
