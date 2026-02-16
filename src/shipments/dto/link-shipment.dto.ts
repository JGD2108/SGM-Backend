import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class LinkShipmentDto {
  @IsString() @IsNotEmpty()
  tramiteId: string;

  @IsString() @IsNotEmpty()
  @IsIn(['ADD', 'REMOVE'])
  action: 'ADD' | 'REMOVE';
}
