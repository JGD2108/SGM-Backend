import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TramitesModule } from '../tramites/tramites.module';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';

@Module({
  imports: [PrismaModule, TramitesModule],
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
