import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** AI 健康检查：发送"你好"验证 LLM 连通性 */
  @Get('health')
  async health() {
    return this.aiService.healthCheck();
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@Body() body: Record<string, unknown>) {
    return this.aiService.chat(body);
  }
}
