import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ClientesService } from './clientes.service';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';

@ApiTags('Clientes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clientes')
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get('by-doc/:doc')
  async findByDoc(@Param('doc') doc: string) {
    return this.service.findByDoc(doc);
  }

  @Get('buscar')
  async buscar(@Query('documento') documento?: string, @Query('q') q?: string) {
    return this.service.search({ documento, q });
  }

  @Get()
  async listOrLookup(@Query('documento') documento?: string, @Query('q') q?: string) {
    return this.service.search({ documento, q });
  }

  @Get(':doc')
  async findByDocumento(@Param('doc') doc: string) {
    return this.service.findByDocumento(doc);
  }

  @Post('upsert')
  async upsert(@Body() dto: UpsertClienteDto) {
    return this.service.upsert(dto);
  }

  @Post()
  async createOrUpsert(@Body() dto: UpsertClienteDto) {
    return this.service.upsert(dto);
  }
}
