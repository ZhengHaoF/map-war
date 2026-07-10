import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { DecideDto } from './decide.dto';
import { AiService, type DecideResult } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('decide')
  @HttpCode(HttpStatus.OK)
  decide(@Body() dto: DecideDto): Promise<DecideResult> {
    return this.aiService.decide(dto.faction, dto.worldState);
  }
}
