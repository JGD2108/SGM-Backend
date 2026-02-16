import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServicioTipo } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @ApiProperty({ example: '123456789' })
  @IsString()
  @MaxLength(40)
  clienteDoc!: string;

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
