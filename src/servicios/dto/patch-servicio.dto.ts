import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class PatchServicioDto {
  @ApiPropertyOptional({
    description: 'Objeto libre con la data del servicio (depende del tipoServicio).',
    example: { placa: 'ABC123', compradorNombre: 'Juan', compradorDoc: '123' },
  })
  @IsOptional()
  @IsObject()
  serviceData?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Carlos Pérez' })
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
