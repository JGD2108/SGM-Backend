import { Module } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
import { CatalogsController } from './catalogs.controller';

@Module({
  providers: [CatalogsService],
  controllers: [CatalogsController]
})
export class CatalogsModule {}
