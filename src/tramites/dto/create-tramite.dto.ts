import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

function optionalTrimmedString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

export class CreateTramiteDto {
  @IsString() @IsNotEmpty()
  concesionarioCode: string;

  @IsString() @IsNotEmpty()
  ciudad: string;

  @IsString() @IsNotEmpty()
  clienteNombre: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteDoc?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  clienteEmail?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteTelefono?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clienteDireccion?: string;

  @IsString() @IsOptional()
  placa?: string;
}
