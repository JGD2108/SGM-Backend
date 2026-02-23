import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SetCuentaCobroBaseDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  service_id?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  serviceId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(150)
  servicio?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
  fecha?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  cliente?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  clienteDoc?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  cliente_doc?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  documento?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  nit_o_cc?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  placa?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  placas?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  ciudad?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  concesionario?: string;
}
