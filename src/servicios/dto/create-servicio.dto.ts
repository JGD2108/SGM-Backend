import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServicioTipo } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

function optionalTrimmedString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

export class CreateServicioDto {
  @ApiProperty({ example: 'AUTOTROPICAL' })
  @IsString()
  @MaxLength(60)
  concesionarioCode!: string;

  @ApiProperty({ example: 'Barranquilla' })
  @IsString()
  @MaxLength(80)
  ciudad!: string;

  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @MaxLength(140)
  clienteNombre!: string;

  @ApiPropertyOptional({ example: '123456789', description: 'Cédula/NIT (opcional si no se tiene).' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteDoc?: string;

  @ApiPropertyOptional({ example: 'cliente@correo.com' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  clienteEmail?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteTelefono?: string;

  @ApiPropertyOptional({ example: 'Calle 1 #2-3, Barranquilla' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clienteDireccion?: string;

  @ApiProperty({ enum: ServicioTipo, example: 'TRASPASO' })
  @IsEnum(ServicioTipo)
  tipoServicio!: ServicioTipo;

  @ApiPropertyOptional({
    description: 'Data libre según plantilla (GET /servicios/templates).',
    example: { placa: 'ABC123', compradorNombre: 'Pedro', compradorDoc: '123' },
  })
  @IsOptional()
  @IsObject()
  serviceData?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Gestor 1' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gestorNombre?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gestorTelefono?: string;
}
