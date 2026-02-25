import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { TramitesService } from '../tramites/tramites.service';
import { SaveCuentaCobroPagosDto } from '../tramites/dto/save-cuenta-cobro-pagos.dto';
import { SetCuentaCobroAbonoDto } from '../tramites/dto/set-cuenta-cobro-abono.dto';
import { SetCuentaCobroBaseDto } from '../tramites/dto/set-cuenta-cobro-base.dto';
import { SetCuentaCobroHonorariosDto } from '../tramites/dto/set-cuenta-cobro-honorarios.dto';
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
  constructor(
    private readonly service: ServiciosService,
    private readonly tramitesService: TramitesService,
  ) {}

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

  @Get(':id/cuenta-cobro')
  async cuentaCobroData(@Param('id') id: string) {
    return this.tramitesService.cuentaCobroData(id);
  }

  @Get(':id/cuenta-cobro/resumen')
  async cuentaCobroResumen(@Param('id') id: string) {
    return this.tramitesService.cuentaCobroResumen(id);
  }

  @Put(':id/cuenta-cobro/pagos')
  async saveCuentaCobroPagos(
    @Param('id') id: string,
    @Body() dto: SaveCuentaCobroPagosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.saveCuentaCobroPagos(id, dto, req.user.id);
  }

  @Post(':id/cuenta-cobro/pagos')
  async saveCuentaCobroPagosPost(
    @Param('id') id: string,
    @Body() dto: SaveCuentaCobroPagosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.saveCuentaCobroPagos(id, dto, req.user.id);
  }

  @Put(':id/cuenta-cobro/conceptos')
  async saveCuentaCobroConceptos(
    @Param('id') id: string,
    @Body() dto: SaveCuentaCobroPagosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.saveCuentaCobroPagos(id, dto, req.user.id);
  }

  @Post(':id/cuenta-cobro/conceptos')
  async saveCuentaCobroConceptosPost(
    @Param('id') id: string,
    @Body() dto: SaveCuentaCobroPagosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.saveCuentaCobroPagos(id, dto, req.user.id);
  }

  @Patch(':id/cuenta-cobro/base')
  async setCuentaCobroBase(@Param('id') id: string, @Body() dto: SetCuentaCobroBaseDto, @Req() req: any) {
    return this.tramitesService.setCuentaCobroBase(id, dto, req.user.id);
  }

  @Post(':id/cuenta-cobro/base')
  async setCuentaCobroBasePost(@Param('id') id: string, @Body() dto: SetCuentaCobroBaseDto, @Req() req: any) {
    return this.tramitesService.setCuentaCobroBase(id, dto, req.user.id);
  }

  @Patch(':id/cuenta-cobro/honorarios')
  async setCuentaCobroHonorarios(
    @Param('id') id: string,
    @Body() dto: SetCuentaCobroHonorariosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.setCuentaCobroHonorarios(id, dto.honorarios, req.user.id);
  }

  @Post(':id/cuenta-cobro/honorarios')
  async setCuentaCobroHonorariosPost(
    @Param('id') id: string,
    @Body() dto: SetCuentaCobroHonorariosDto,
    @Req() req: any,
  ) {
    return this.tramitesService.setCuentaCobroHonorarios(id, dto.honorarios, req.user.id);
  }

  @Patch(':id/cuenta-cobro/abono')
  async setCuentaCobroAbono(@Param('id') id: string, @Body() dto: SetCuentaCobroAbonoDto, @Req() req: any) {
    return this.tramitesService.setCuentaCobroAbono(id, dto.abono, req.user.id);
  }

  @Post(':id/cuenta-cobro/abono')
  async setCuentaCobroAbonoPost(@Param('id') id: string, @Body() dto: SetCuentaCobroAbonoDto, @Req() req: any) {
    return this.tramitesService.setCuentaCobroAbono(id, dto.abono, req.user.id);
  }

  @Get(':id/cuenta-cobro.pdf')
  async cuentaCobroPdf(@Param('id') id: string, @Res() res: Response) {
    return this.tramitesService.cuentaCobroPdf(id, res);
  }
}
