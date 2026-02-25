import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

function optionalTrimmedString(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

export class UpsertClienteDto {
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  documento?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  doc?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clienteDoc?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  identificacion?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(140)
  nombre?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(140)
  clienteNombre?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(140)
  razon_social?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  celular?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  direccion?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  correo?: string;
}
