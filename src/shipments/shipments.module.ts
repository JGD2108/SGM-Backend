import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { TramiteShipmentsController } from './tramite-shipments.controller';

@Module({
  controllers: [ShipmentsController, TramiteShipmentsController],
  providers: [ShipmentsService],
})
export class ShipmentsModule {}
