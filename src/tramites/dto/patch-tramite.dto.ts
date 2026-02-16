import { IsOptional, IsString } from 'class-validator';

export class PatchTramiteDto {
  @IsString() @IsOptional()
  placa?: string;

  @IsString() @IsOptional()
  ciudad?: string;

  @IsString() @IsOptional()
  concesionarioCode?: string;

  @IsOptional()
  honorariosValor?: number | string;
}
