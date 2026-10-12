import type { NestExpressApplication } from '@nestjs/platform-express';
import { AiProxyConfig } from './ai/ai-proxy.config';
import { AI_PROXY_CONFIG } from './ai/llm.client';

/** main.ts 与离线测试共用的应用配置 */
export function configureApp(app: NestExpressApplication, env: Record<string, string | undefined> = process.env): void {
  const cfg = app.get<AiProxyConfig>(AI_PROXY_CONFIG);
  const corsOrigin = env.CORS_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin: corsOrigin.split(',').map(s => s.trim()), credentials: true });
  // 显式请求体上限（需以 bodyParser:false 创建应用）；字符级预算由 chat schema 再校验
  app.useBodyParser('json', { limit: cfg.maxBodyBytes });
  // 不启用 express "trust proxy"：认证/限流只看 socket 对端地址与共享秘钥，不信任 X-Forwarded-For
  app.set('trust proxy', false);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
}
