import { timingSafeEqual, createHash } from 'node:crypto';
import { AiProxyConfig, configBlockReason } from './ai-proxy.config';

/** 认证所需的最小请求视图（与 Express 解耦，便于离线测试） */
export interface AuthRequestView {
  remoteAddress: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}

export type AuthResult =
  | { ok: true; clientId: string }
  | { ok: false; status: 401 | 403 | 503; code: string; error: string };

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDED_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  if (LOOPBACK.has(addr)) return true;
  return /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(addr);
}

function headerValue(h: AuthRequestView['headers'], name: string): string | undefined {
  const v = h[name];
  if (Array.isArray(v)) return v.length === 1 ? v[0] : undefined; // 多值视为可疑
  return v;
}

function secretEquals(given: string, expected: string): boolean {
  // 先做摘要再比较：长度无关且恒定时间
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * 逐请求认证：
 * - local-dev：仅 NODE_ENV!=production、对端为回环地址、且无转发头（防止同机反代把公网流量伪装成本机）。
 * - shared-secret：反向代理在完成自身 session/登录校验后注入秘钥头；浏览器/前端不持有秘钥。
 * - disabled / 未配置 / 配置错误：一律拒绝。
 */
export function authorizeAiRequest(cfg: AiProxyConfig, req: AuthRequestView): AuthResult {
  const blocked = configBlockReason(cfg);
  if (blocked) return { ok: false, status: 503, code: 'ai_proxy_unavailable', error: blocked };

  if (cfg.authMode === 'local-dev') {
    if (cfg.production) {
      return { ok: false, status: 503, code: 'ai_proxy_unavailable', error: 'production 下不允许 local-dev 认证模式' };
    }
    if (!isLoopback(req.remoteAddress)) {
      return { ok: false, status: 403, code: 'ai_forbidden', error: 'local-dev 模式仅接受本机回环请求；公网/局域网部署请配置 AI_PROXY_AUTH_MODE=shared-secret' };
    }
    if (!cfg.devAllowForwarded && FORWARDED_HEADERS.some(h => req.headers[h] !== undefined)) {
      return { ok: false, status: 403, code: 'ai_forbidden', error: 'local-dev 模式拒绝经转发的请求（检测到 X-Forwarded-*/Forwarded 头）' };
    }
    return { ok: true, clientId: `ip:${req.remoteAddress}` };
  }

  // shared-secret
  const given = headerValue(req.headers, cfg.secretHeader);
  if (!given || !cfg.sharedSecret || !secretEquals(given, cfg.sharedSecret)) {
    return { ok: false, status: 401, code: 'ai_unauthorized', error: 'AI 代理认证失败' };
  }
  if (cfg.clientIdHeader) {
    const id = headerValue(req.headers, cfg.clientIdHeader)?.trim();
    if (id) return { ok: true, clientId: `user:${id.slice(0, 200)}` };
  }
  return { ok: true, clientId: `ip:${req.remoteAddress ?? 'unknown'}` };
}
