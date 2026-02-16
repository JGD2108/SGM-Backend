import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { TramitesModule } from './tramites/tramites.module';
import { FilesModule } from './files/files.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { ServiciosModule } from './servicios/servicios.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.API_RATE_TTL_MS ?? 60_000),
          limit: Number(process.env.API_RATE_LIMIT ?? 120),
        },
      ],
    }),
    PrismaModule,
    StorageModule,
    CatalogsModule,
    AuthModule,
    TramitesModule,
    FilesModule,
    ShipmentsModule,
    PaymentsModule,
    ReportsModule,
    ServiciosModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
