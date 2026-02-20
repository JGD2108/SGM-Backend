import { IsOptional, IsString } from 'class-validator';

export class UploadTramiteFileDto {
  @IsString() @IsOptional()
  docKey?: string;

  @IsString() @IsOptional()
  documentTypeId?: string;

  @IsString() @IsOptional()
  filenameOriginal?: string;

  @IsString() @IsOptional()
  customName?: string;

  @IsString() @IsOptional()
  nombrePersonalizado?: string;
}
