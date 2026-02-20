import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelServicioDto {
  @ApiPropertyOptional({ example: 'Cliente solicito cancelacion.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
