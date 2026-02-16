import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTramiteDto {
  @IsString() @IsNotEmpty()
  concesionarioCode: string;

  @IsString() @IsNotEmpty()
  ciudad: string;

  @IsString() @IsNotEmpty()
  clienteNombre: string;

  @IsString() @IsNotEmpty()
  clienteDoc: string;

  @IsString() @IsOptional()
  placa?: string;
}
