import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { createLLMClient, getModel } from './llm.client';
import { GAME_TOOLS, toolCallToOrder, type Order } from './tools';
import { buildSystemPrompt } from './prompt';

export interface DecideResult {
  orders: Order[];
  thinking: string;
  raw: unknown;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    this.client = createLLMClient();
    this.model = getModel();
  }

  async decide(
    faction: string,
    worldState: Record<string, unknown>,
  ): Promise<DecideResult> {
    const systemPrompt = buildSystemPrompt({ ...worldState, faction });
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ faction, worldState }) },
    ];
    const tools = GAME_TOOLS as unknown as ChatCompletionTool[];

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools,
        stream: false,
      });

      const message = completion.choices[0]?.message;
      const reasoning = (message as unknown as { reasoning_content?: string })?.reasoning_content;
      const thinking = [message?.content, reasoning]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .join('\n');

      const orders: Order[] = [];
      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          const order = toolCallToOrder(tc);
          if (order) orders.push(order);
        }
      }

      return { orders, thinking, raw: completion };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`LLM decide failed for faction=${faction}: ${msg}`);
      throw new HttpException({ error: msg }, HttpStatus.BAD_GATEWAY);
    }
  }
}
