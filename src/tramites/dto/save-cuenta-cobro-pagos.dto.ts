import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const CUENTA_COBRO_CONCEPT_KEYS = [
  'IMPUESTO_TIMBRE',
  'IMPUESTO_TRANSITO',
  'MATRICULA',
  'SERVICIO_PRINCIPAL',
  'ENVIO_1',
  'ENVIO_2',
  'PAGO_MULTAS',
] as const;

const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CONSIGNACION', 'PSE', 'OTRO'] as const;

function normalizeAmountOrZero(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;
  return Number(value);
}

function normalizeYear(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return Number(value);
}

export class CuentaCobroPagoItemDto {
  @IsString()
  @IsOptional()
  concept_name?: string;

  @IsString()
  @IsIn(CUENTA_COBRO_CONCEPT_KEYS)
  @IsOptional()
  concepto_key?: (typeof CUENTA_COBRO_CONCEPT_KEYS)[number];

  @Transform(({ value }) => normalizeAmountOrZero(value))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  amount_total?: number;

  @Transform(({ value }) => normalizeAmountOrZero(value))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  amount_4x1000?: number;

  @Transform(({ value }) => normalizeYear(value))
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @IsOptional()
  anio?: number;

  @Transform(({ value }) => normalizeYear(value))
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @IsOptional()
  year?: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
  @IsOptional()
  fecha?: string;

  @IsString()
  @IsIn(PAYMENT_METHODS)
  @IsOptional()
  medio_pago?: (typeof PAYMENT_METHODS)[number];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class SaveCuentaCobroPagosDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CuentaCobroPagoItemDto)
  items: CuentaCobroPagoItemDto[];
}
