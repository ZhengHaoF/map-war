import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiProxyError, AiService, ClientGoneError } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * AI 健康检查。默认只报告配置状态，不调用上游模型（零成本）。
   * `?probe=1` 才做真实探活，且需 AI_HEALTH_PROBE_ENABLED=true、认证通过、计入限流并有冷却缓存。
   */
  @Get('health')
  async health(@Query('probe') probe: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (probe !== '1' && probe !== 'true') return this.aiService.healthStatus();
    return this.run(req, res, (clientId, signal) => this.aiService.healthProbe({ clientId, signal }));
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async chat(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(req, res, (clientId, signal) => this.aiService.chat(body, { clientId, signal }));
  }

  private async run<T>(req: Request, res: Response, fn: (clientId: string, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const auth = this.aiService.authorize({ remoteAddress: req.socket.remoteAddress, headers: req.headers });
    if (!auth.ok) {
      throw new HttpException({ error: auth.error, code: auth.code }, auth.status);
    }

    // 客户端断开（含前端 AbortController / 超时）→ 取消排队并中止上游请求
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort(new ClientGoneError());
    };
    res.on('close', onClose);
    try {
      return await fn(auth.clientId, controller.signal);
    } catch (err) {
      if (err instanceof ClientGoneError || controller.signal.aborted) {
        // 连接已关闭，无法再写响应；返回 undefined 让框架安静结束
        return undefined;
      }
      if (err instanceof AiProxyError) {
        if (err.retryAfterSec) res.setHeader('Retry-After', String(err.retryAfterSec));
        throw new HttpException(
          { error: err.error, code: err.code, ...(err.detail ? { detail: err.detail } : {}), ...(err.extra ?? {}) },
          err.status,
        );
      }
      throw err;
    } finally {
      res.off('close', onClose);
    }
  }
}
