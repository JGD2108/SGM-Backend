import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReabrirDto {
  @IsString() @IsNotEmpty()
  reason: string;

  @IsString() @IsOptional()
  toEstado?: string;
}
