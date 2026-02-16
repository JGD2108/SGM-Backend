import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsString() @IsNotEmpty()
  tipo: 'TIMBRE' | 'DERECHOS' | 'OTRO';

  @IsInt() @Min(0)
  valor: number;

  // YYYY-MM-DD o ISO
  @IsString() @IsNotEmpty()
  fecha: string;

  @IsString() @IsNotEmpty()
  medio_pago: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'CONSIGNACION' | 'OTRO';

  @IsString() @IsOptional()
  notes?: string;
}
