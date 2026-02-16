import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateServicioPagoDto {
  @ApiProperty({ example: 'Derechos de tránsito (total)' })
  @IsString()
  @MaxLength(200)
  concepto!: string;

  @ApiProperty({ example: 250000 })
  @IsInt()
  @Min(0)
  valor!: number;
}
