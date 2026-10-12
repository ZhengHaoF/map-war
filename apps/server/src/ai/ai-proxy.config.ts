/**
 * AI 代理安全配置（纯函数，便于离线测试）。
 *
 * 所有预算/限流/认证参数集中在这里解析；非法数值会记录到 `errors`，
 * 并让 AI 端点 fail closed（返回 503），而不是悄悄回退到不安全的值。
 * 详见 docs/ai-proxy-security.md。
 */

export type AiAuthMode = 'local-dev' | 'shared-secret' | 'disabled';
export type ReasoningEffort = 'low' | 'medium' | 'high';
export const VALID_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];
export const AUTH_MODES: readonly AiAuthMode[] = ['local-dev', 'shared-secret', 'disabled'];
export const MIN_SHARED_SECRET_LENGTH = 32;

export interface AiProxyConfig {
  production: boolean;
  /** 已解析的认证模式；null = 未配置（production 下 fail closed） */
  authMode: AiAuthMode | null;
  sharedSecret: string | null;
  secretHeader: string;
  /** 仅在共享秘钥通过后才信任的身份头（用作限流 key），如 x-auth-request-user */
  clientIdHeader: string | null;
  /** local-dev 模式下是否接受带 X-Forwarded-For/Forwarded 的请求（默认否） */
  devAllowForwarded: boolean;

  /** LLM 上游 */
  llmConfigured: boolean;
  missingEnv: string[];
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: ReasoningEffort;
  upstreamTimeoutMs: number;
  upstreamMaxRetries: number;

  /** 请求/输出预算 */
  maxBodyBytes: number;
  maxMessages: number;
  maxMessageChars: number;
  maxTotalChars: number;
  maxOutputTokens: number;
  maxJsonSchemaChars: number;

  /** 限流与并发 */
  rateLimitPerClientPerMin: number;
  rateLimitGlobalPerMin: number;
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;

  /** 健康检查 */
  healthProbeEnabled: boolean;
  healthProbeCooldownMs: number;

  /** 配置错误（任一非空 → AI 调用 fail closed） */
  errors: string[];
}

type Env = Record<string, string | undefined>;

const REQUIRED_LLM_ENV = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

function intEnv(env: Env, key: string, def: number, min: number, max: number, errors: string[]): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  if (!/^\d+$/.test(raw.trim())) {
    errors.push(`${key} 必须是整数（当前: ${JSON.stringify(raw)}）`);
    return def;
  }
  const n = Number(raw.trim());
  if (n < min || n > max) {
    errors.push(`${key} 必须在 ${min}..${max} 之间（当前: ${n}）`);
    return def;
  }
  return n;
}

function boolEnv(env: Env, key: string, def: boolean, errors: string[]): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  errors.push(`${key} 必须是 true/false（当前: ${JSON.stringify(env[key])}）`);
  return def;
}

export function loadAiProxyConfig(env: Env = process.env): AiProxyConfig {
  const errors: string[] = [];
  const production = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  // ── 认证 ──
  const rawMode = env.AI_PROXY_AUTH_MODE?.trim().toLowerCase();
  let authMode: AiAuthMode | null;
  if (!rawMode) {
    // 开发默认仅允许本机回环直连；生产未配置 → null（拒绝 AI 调用）
    authMode = production ? null : 'local-dev';
    if (production) errors.push('production 下必须设置 AI_PROXY_AUTH_MODE=shared-secret（或 disabled 关闭 AI）');
  } else if ((AUTH_MODES as readonly string[]).includes(rawMode)) {
    authMode = rawMode as AiAuthMode;
  } else {
    authMode = null;
    errors.push(`AI_PROXY_AUTH_MODE 只能是 ${AUTH_MODES.join(' / ')}（当前: ${JSON.stringify(env.AI_PROXY_AUTH_MODE)}）`);
  }
  if (production && authMode === 'local-dev') {
    errors.push('production 下不允许 AI_PROXY_AUTH_MODE=local-dev');
  }

  const sharedSecret = env.AI_PROXY_SHARED_SECRET ?? null;
  if (authMode === 'shared-secret') {
    if (!sharedSecret || sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
      errors.push(`AI_PROXY_AUTH_MODE=shared-secret 需要 AI_PROXY_SHARED_SECRET（至少 ${MIN_SHARED_SECRET_LENGTH} 字符）`);
    }
  }
  const secretHeader = (env.AI_PROXY_SECRET_HEADER?.trim() || 'x-ai-proxy-secret').toLowerCase();
  const clientIdHeader = env.AI_PROXY_CLIENT_ID_HEADER?.trim().toLowerCase() || null;
  const headerRe = /^[a-z0-9-]+$/;
  if (!headerRe.test(secretHeader)) errors.push('AI_PROXY_SECRET_HEADER 不是合法的 header 名');
  if (clientIdHeader && !headerRe.test(clientIdHeader)) errors.push('AI_PROXY_CLIENT_ID_HEADER 不是合法的 header 名');
  const devAllowForwarded = boolEnv(env, 'AI_PROXY_DEV_ALLOW_FORWARDED', false, errors);

  // ── LLM ──
  const missingEnv = REQUIRED_LLM_ENV.filter(k => !env[k]);
  const llmConfigured = missingEnv.length === 0;
  const defaultModel = env.LLM_MODEL?.trim() || 'deepseek-chat';
  const allowedRaw = env.LLM_ALLOWED_MODELS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const allowedModels = allowedRaw.length ? allowedRaw : [defaultModel];
  if (!allowedModels.includes(defaultModel)) {
    errors.push(`LLM_ALLOWED_MODELS 必须包含默认模型 LLM_MODEL=${defaultModel}`);
  }
  const effortRaw = (env.LLM_REASONING_EFFORT ?? 'low').trim().toLowerCase();
  const defaultReasoningEffort = (VALID_EFFORTS as readonly string[]).includes(effortRaw)
    ? (effortRaw as ReasoningEffort)
    : 'low';

  // 前端单次尝试超时 90s（WORLD_AI_ATTEMPT_TIMEOUT_MS），排队 15s + 上游 70s 留出余量
  const upstreamTimeoutMs = intEnv(env, 'LLM_TIMEOUT_MS', 70_000, 1_000, 300_000, errors);
  // 前端已有 3 次退避重试；后端默认不再重试，避免 3×3 放大
  const upstreamMaxRetries = intEnv(env, 'LLM_MAX_RETRIES', 0, 0, 2, errors);

  const cfg: AiProxyConfig = {
    production,
    authMode,
    sharedSecret,
    secretHeader,
    clientIdHeader,
    devAllowForwarded,
    llmConfigured,
    missingEnv,
    defaultModel,
    allowedModels,
    defaultReasoningEffort,
    upstreamTimeoutMs,
    upstreamMaxRetries,
    maxBodyBytes: intEnv(env, 'AI_MAX_BODY_BYTES', 512 * 1024, 1024, 4 * 1024 * 1024, errors),
    maxMessages: intEnv(env, 'AI_MAX_MESSAGES', 40, 1, 500, errors),
    maxMessageChars: intEnv(env, 'AI_MAX_MESSAGE_CHARS', 60_000, 100, 1_000_000, errors),
    maxTotalChars: intEnv(env, 'AI_MAX_TOTAL_CHARS', 100_000, 100, 2_000_000, errors),
    maxOutputTokens: intEnv(env, 'LLM_MAX_OUTPUT_TOKENS', 8192, 16, 65_536, errors),
    maxJsonSchemaChars: intEnv(env, 'AI_MAX_JSON_SCHEMA_CHARS', 16_000, 100, 200_000, errors),
    rateLimitPerClientPerMin: intEnv(env, 'AI_RATE_LIMIT_PER_CLIENT_PER_MIN', 40, 1, 10_000, errors),
    rateLimitGlobalPerMin: intEnv(env, 'AI_RATE_LIMIT_GLOBAL_PER_MIN', 120, 1, 100_000, errors),
    maxConcurrent: intEnv(env, 'AI_MAX_CONCURRENT', 12, 1, 256, errors),
    maxQueue: intEnv(env, 'AI_MAX_QUEUE', 24, 0, 1024, errors),
    queueTimeoutMs: intEnv(env, 'AI_QUEUE_TIMEOUT_MS', 15_000, 0, 120_000, errors),
    healthProbeEnabled: boolEnv(env, 'AI_HEALTH_PROBE_ENABLED', false, errors),
    healthProbeCooldownMs: intEnv(env, 'AI_HEALTH_PROBE_COOLDOWN_MS', 300_000, 10_000, 86_400_000, errors),
    errors,
  };
  return cfg;
}

/** AI 调用是否被配置层面禁止（返回原因），null 表示可继续做逐请求认证 */
export function configBlockReason(cfg: AiProxyConfig): string | null {
  if (cfg.errors.length) return 'AI 代理配置无效或缺少认证配置，已拒绝 AI 调用';
  if (cfg.authMode === null) return 'AI 代理未配置认证，已拒绝 AI 调用';
  if (cfg.authMode === 'disabled') return 'AI 代理已被禁用（AI_PROXY_AUTH_MODE=disabled）';
  return null;
}
