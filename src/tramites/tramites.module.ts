import { Module } from '@nestjs/common';
import { TramitesService } from './tramites.service';
import { TramitesController } from './tramites.controller';

@Module({
  providers: [TramitesService],
  controllers: [TramitesController]
})
export class TramitesModule {}
