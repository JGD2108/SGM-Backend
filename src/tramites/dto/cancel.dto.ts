import { IsOptional, IsString } from 'class-validator';

export class CancelDto {
  @IsString() @IsOptional()
  reason?: string;
}
