import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreateShipmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  numero_guia: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  transportadora: string;

  @IsInt()
  @Min(0)
  costo: number;

  // YYYY-MM-DD o ISO
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
  fecha_envio: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  tramiteId?: string;
}
