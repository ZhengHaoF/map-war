import { IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class DecideDto {
  @IsString()
  faction!: string;

  @Type(() => Object)
  worldState!: Record<string, unknown>;
}
