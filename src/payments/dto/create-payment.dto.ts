import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const PAYMENT_TYPES = ['TIMBRE', 'DERECHOS', 'OTRO'] as const;
const PAYMENT_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CONSIGNACION', 'PSE', 'OTRO'] as const;

export class CreatePaymentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_TYPES)
  tipo: (typeof PAYMENT_TYPES)[number];

  @IsInt()
  @Min(0)
  valor: number;

  // YYYY-MM-DD o ISO
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
  fecha: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_METHODS)
  medio_pago: (typeof PAYMENT_METHODS)[number];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
