import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ChangeEstadoDto {
  @IsString()
  toEstado: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  placa?: string;
}
