import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadTramiteFileDto {
  @IsString() @IsNotEmpty()
  docKey: string; // FACTURA, EVIDENCIA_PLACA, etc.

  @IsString() @IsOptional()
  documentTypeId?: string;
}
