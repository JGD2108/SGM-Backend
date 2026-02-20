import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ServiciosService } from './servicios.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { ChangeServicioEstadoDto } from './dto/change-servicio-estado.dto';
import { CancelServicioDto } from './dto/cancel-servicio.dto';
import { CreateServicioPagoDto } from './dto/create-servicio-pago.dto';
import { PatchServicioDto } from './dto/patch-servicio.dto';

@ApiTags('Servicios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('servicios')
export class ServiciosController {
  constructor(private readonly service: ServiciosService) {}

  @Get('templates')
  templates() {
    return this.service.templates();
  }

  @Get()
  async list(@Query() query: any) {
    return this.service.list(query);
  }

  @Post()
  async create(@Body() dto: CreateServicioDto, @Req() req: any) {
    return this.service.create(dto, req.user.id);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: PatchServicioDto, @Req() req: any) {
    return this.service.patch(id, dto, req.user.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.cancelar(id, undefined, req.user.id);
  }

  @Post(':id/cancelar')
  async cancelar(@Param('id') id: string, @Body() dto: CancelServicioDto, @Req() req: any) {
    return this.service.cancelar(id, dto.reason, req.user.id);
  }

  @Post(':id/estado')
  async changeEstado(@Param('id') id: string, @Body() dto: ChangeServicioEstadoDto, @Req() req: any) {
    return this.service.changeEstado(id, dto.toEstado as any, dto.notes, req.user.id);
  }

  @Get(':id/estados/historial')
  async historial(@Param('id') id: string) {
    return this.service.historialEstados(id);
  }

  @Post(':id/pagos')
  async addPago(@Param('id') id: string, @Body() dto: CreateServicioPagoDto, @Req() req: any) {
    return this.service.addPago(id, dto, req.user.id);
  }

  @Get(':id/pagos')
  async listPagos(@Param('id') id: string) {
    return this.service.listPagos(id);
  }
}
