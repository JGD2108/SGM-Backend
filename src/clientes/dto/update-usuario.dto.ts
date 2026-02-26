import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

function nullableTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return value as any;
}

export class UpdateUsuarioDto {
  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(140)
  nombre?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(140)
  name?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  documento?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  doc?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(200)
  direccion?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  telefono?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  rol?: string | null;

  @Transform(({ value }) => nullableTrimmedString(value))
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  role?: string | null;

  @Transform(({ value }) => optionalBoolean(value))
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @Transform(({ value }) => optionalBoolean(value))
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
