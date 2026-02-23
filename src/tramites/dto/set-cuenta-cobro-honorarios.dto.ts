import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

function normalizeAmountOrZero(value: unknown) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;
  return Number(value);
}

export class SetCuentaCobroHonorariosDto {
  @Transform(({ value }) => normalizeAmountOrZero(value))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  honorarios?: number;
}
