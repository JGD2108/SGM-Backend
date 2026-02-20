import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadTramiteFileDto {
  @IsString() @IsNotEmpty()
  docKey: string; // FACTURA, EVIDENCIA_PLACA, OTRO, etc.

  @IsString() @IsOptional()
  documentTypeId?: string;

  @IsString() @IsOptional()
  filenameOriginal?: string;

  @IsString() @IsOptional()
  customName?: string;

  @IsString() @IsOptional()
  nombrePersonalizado?: string;
}
