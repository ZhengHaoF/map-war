import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AiProxyConfig } from './ai-proxy.config';
import { authorizeAiRequest, AuthRequestView, AuthResult } from './ai-auth';
import { ChatValidationError, SanitizedChatParams, validateChatRequest } from './chat-request.schema';
import { AbortedError, ConcurrencyLimiter, FixedWindowRateLimiter, QueueRejectedError } from './limiters';
import { AI_PROXY_CONFIG, LLM_CLIENT, LlmClientLike } from './llm.client';

/** 统一的代理错误；controller 负责转换为 HTTP 响应 */
export class AiProxyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly error: string,
    public readonly detail?: string,
    public readonly retryAfterSec?: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(error);
    this.name = 'AiProxyError';
  }
}

/** 客户端已断开：不再有可写的响应 */
export class ClientGoneError extends Error {
  constructor() {
    super('client disconnected');
    this.name = 'ClientGoneError';
  }
}

export interface ChatContext {
  clientId: string;
  signal: AbortSignal;
}

export interface HealthResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  probed: boolean;
  cached?: boolean;
  error?: string;
}

const MINUTE = 60_000;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly perClient: FixedWindowRateLimiter;
  private readonly global: FixedWindowRateLimiter;
  private readonly concurrency: ConcurrencyLimiter;
  private lastProbe: { at: number; result: HealthResult } | null = null;
  private probeInFlight: Promise<HealthResult> | null = null;

  constructor(
    @Inject(AI_PROXY_CONFIG) private readonly cfg: AiProxyConfig,
    @Optional() @Inject(LLM_CLIENT) private readonly client: LlmClientLike | null,
  ) {
    this.perClient = new FixedWindowRateLimiter(cfg.rateLimitPerClientPerMin, MINUTE);
    this.global = new FixedWindowRateLimiter(cfg.rateLimitGlobalPerMin, MINUTE);
    this.concurrency = new ConcurrencyLimiter(cfg.maxConcurrent, cfg.maxQueue, cfg.queueTimeoutMs);
    if (cfg.errors.length) {
      this.logger.error(`AI 代理配置错误，AI 调用将被拒绝: ${cfg.errors.join(' | ')}`);
    }
    this.logger.log(
      `AI proxy: auth=${cfg.authMode ?? 'unconfigured'} production=${cfg.production} models=[${cfg.allowedModels.join(',')}] ` +
      `timeout=${cfg.upstreamTimeoutMs}ms retries=${cfg.upstreamMaxRetries} maxOut=${cfg.maxOutputTokens} ` +
      `rate=${cfg.rateLimitPerClientPerMin}/min/client,${cfg.rateLimitGlobalPerMin}/min/global ` +
      `concurrency=${cfg.maxConcurrent} queue=${cfg.maxQueue}`,
    );
  }

  get config(): AiProxyConfig { return this.cfg; }

  authorize(req: AuthRequestView): AuthResult {
    return authorizeAiRequest(this.cfg, req);
  }

  private requireClient(): LlmClientLike {
    if (!this.client) {
      throw new AiProxyError(
        503,
        'ai_not_configured',
        'AI 服务未配置',
        this.cfg.production ? undefined : `缺少环境变量: ${this.cfg.missingEnv.join(', ')}`,
        undefined,
        this.cfg.production ? undefined : { hint: '请在 apps/server/ 下创建 .env 文件，参考 .env.example 填写 API Key' },
      );
    }
    return this.client;
  }

  private consumeRate(clientId: string): void {
    const wait = this.perClient.tryConsume(clientId);
    if (wait !== null) {
      throw new AiProxyError(429, 'ai_rate_limited', 'AI 请求过于频繁，请稍后再试', undefined, Math.ceil(wait / 1000));
    }
    const gWait = this.global.tryConsume('*');
    if (gWait !== null) {
      this.perClient.refund(clientId);
      throw new AiProxyError(429, 'ai_rate_limited', 'AI 服务整体请求量已达上限，请稍后再试', undefined, Math.ceil(gWait / 1000));
    }
  }

  private async withSlot<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    try {
      release = await this.concurrency.acquire(signal);
    } catch (err) {
      if (err instanceof AbortedError) throw new ClientGoneError();
      if (err instanceof QueueRejectedError) {
        throw new AiProxyError(503, 'ai_busy', 'AI 服务繁忙，请稍后重试', err.message, 2);
      }
      throw err;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private mapUpstreamError(err: unknown, signal: AbortSignal): never {
    if (signal.aborted) throw new ClientGoneError();
    const e = err as { name?: string; status?: number; message?: string };
    const name = e?.name ?? '';
    const msg = String(e?.message ?? 'unknown').slice(0, 300);
    if (name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(msg)) {
      throw new AiProxyError(504, 'ai_upstream_timeout', 'AI 上游响应超时', msg);
    }
    throw new AiProxyError(502, 'ai_upstream_error', 'AI 请求失败',
      typeof e?.status === 'number' ? `上游 HTTP ${e.status}: ${msg}` : msg);
  }

  async chat(body: unknown, ctx: ChatContext): Promise<unknown> {
    const client = this.requireClient();
    this.consumeRate(ctx.clientId);

    let params: SanitizedChatParams;
    try {
      params = validateChatRequest(body, this.cfg);
    } catch (err) {
      if (err instanceof ChatValidationError) {
        throw new AiProxyError(400, 'ai_invalid_request', '请求参数无效', err.issues.join('; '));
      }
      throw err;
    }

    // 只记录元数据，不记录 prompt / 回复内容
    const totalChars = params.messages.reduce((n, m) => n + m.content.length, 0);
    this.logger.log(
      `AI chat: client=${ctx.clientId} model=${params.model} messages=${params.messages.length} chars=${totalChars} ` +
      `format=${params.response_format?.type ?? 'default'} effort=${params.reasoning_effort} max_tokens=${params.max_tokens}`,
    );

    return this.withSlot(ctx.signal, async () => {
      if (ctx.signal.aborted) throw new ClientGoneError();
      const start = Date.now();
      try {
        const res = await client.chat.completions.create(params, {
          signal: ctx.signal,
          timeout: this.cfg.upstreamTimeoutMs,
          maxRetries: this.cfg.upstreamMaxRetries,
        });
        this.logger.log(`AI chat done: client=${ctx.clientId} latency=${Date.now() - start}ms`);
        return res;
      } catch (err) {
        this.logger.warn(`AI chat failed: client=${ctx.clientId} latency=${Date.now() - start}ms aborted=${ctx.signal.aborted} err=${(err as Error)?.name}`);
        this.mapUpstreamError(err, ctx.signal);
      }
    });
  }

  /** 无成本的配置状态检查（默认 /api/ai/health 行为） */
  healthStatus(): HealthResult {
    const authOk = this.cfg.errors.length === 0 && this.cfg.authMode !== null && this.cfg.authMode !== 'disabled';
    const ok = this.cfg.llmConfigured && authOk;
    let error: string | undefined;
    if (!this.cfg.llmConfigured) {
      error = this.cfg.production ? 'AI 服务未配置' : `AI 服务未配置，缺少: ${this.cfg.missingEnv.join(', ')}`;
    } else if (!authOk) {
      error = 'AI 代理认证未配置或配置无效';
    }
    return { ok, model: this.cfg.defaultModel, latencyMs: 0, probed: false, ...(error ? { error } : {}) };
  }

  /**
   * 真实上游探活：需 AI_HEALTH_PROBE_ENABLED=true + 认证通过 + 计入限流，
   * 且在冷却期内复用上次结果（并发请求合并为一次），避免健康检查无保护地产生成本。
   */
  async healthProbe(ctx: ChatContext): Promise<HealthResult> {
    if (!this.cfg.healthProbeEnabled) {
      throw new AiProxyError(403, 'ai_probe_disabled', '上游探活未启用（AI_HEALTH_PROBE_ENABLED=false）');
    }
    const client = this.requireClient();
    const now = Date.now();
    if (this.lastProbe && now - this.lastProbe.at < this.cfg.healthProbeCooldownMs) {
      return { ...this.lastProbe.result, cached: true };
    }
    if (this.probeInFlight) return { ...(await this.probeInFlight), cached: true };
    this.consumeRate(ctx.clientId);

    const run = this.withSlot(ctx.signal, async () => {
      const start = Date.now();
      try {
        const res = await client.chat.completions.create({
          model: this.cfg.defaultModel,
          messages: [{ role: 'user', content: '请只回复 ok' }],
          max_tokens: 16,
          reasoning_effort: 'low',
          stream: false,
        }, {
          // 探活不随单个调用方断开而取消，结果会被缓存共享
          timeout: Math.min(this.cfg.upstreamTimeoutMs, 15_000),
          maxRetries: 0,
        });
        const reply = (res as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '';
        return { ok: true, model: this.cfg.defaultModel, latencyMs: Date.now() - start, probed: true, ...(reply ? {} : { error: 'AI 返回为空' }) };
      } catch (err) {
        return { ok: false, model: this.cfg.defaultModel, latencyMs: Date.now() - start, probed: true, error: String((err as Error)?.message ?? err).slice(0, 300) };
      }
    });
    this.probeInFlight = run;
    try {
      const result = await run;
      this.lastProbe = { at: Date.now(), result };
      return result;
    } finally {
      this.probeInFlight = null;
    }
  }
}
