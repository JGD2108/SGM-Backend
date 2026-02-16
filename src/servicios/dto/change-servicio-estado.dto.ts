import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServicioEstado } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChangeServicioEstadoDto {
  @ApiProperty({ enum: ServicioEstado, example: 'RADICADO' })
  @IsEnum(ServicioEstado)
  toEstado!: ServicioEstado;

  @ApiPropertyOptional({ example: 'Radicado con recibo No. 123' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
