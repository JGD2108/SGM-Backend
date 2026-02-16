import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { CatalogsService } from './catalogs.service';

@ApiTags('Catalogs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly service: CatalogsService) {}

  @Get('concesionarios')
  async concesionarios() {
    return this.service.concesionarios();
  }

  @Get('ciudades')
  async ciudades() {
    return this.service.ciudades();
  }

  @Get('document-types')
  async documentTypes() {
    return this.service.documentTypes();
  }

  @Get('alert-rules')
  async alertRules() {
    return this.service.alertRules();
  }
}
