import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { loadAiProxyConfig } from './ai-proxy.config';
import { AI_PROXY_CONFIG, LLM_CLIENT, createLLMClient } from './llm.client';

@Module({
  controllers: [AiController],
  providers: [
    { provide: AI_PROXY_CONFIG, useFactory: () => loadAiProxyConfig(process.env) },
    { provide: LLM_CLIENT, useFactory: createLLMClient, inject: [AI_PROXY_CONFIG] },
    AiService,
  ],
  exports: [AI_PROXY_CONFIG],
})
export class AiModule {}
