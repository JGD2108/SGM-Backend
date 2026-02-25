import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CONSIGNACION', 'PSE', 'OTRO'] as const;

export class UpdatePaymentDto {
  @IsInt()
  @Min(0)
  @IsOptional()
  valor?: number;

  // YYYY-MM-DD o ISO
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
  @IsOptional()
  fecha?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  medio_pago?: (typeof PAYMENT_METHODS)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
