import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateShipmentDto {
  @IsString() @IsNotEmpty()
  numero_guia: string;

  @IsString() @IsNotEmpty()
  transportadora: string;

  @IsInt() @Min(0)
  costo: number;

  // YYYY-MM-DD (simple)
  @IsString() @IsNotEmpty()
  fecha_envio: string;

  @IsString() @IsOptional()
  notes?: string;

  // opcional: si el Front algún día decide mandar tramiteId directo
  @IsString() @IsOptional()
  tramiteId?: string;
}
