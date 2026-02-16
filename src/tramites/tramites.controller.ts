import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { TramitesService } from './tramites.service';
import { CreateTramiteDto } from './dto/create-tramite.dto';
import { PatchTramiteDto } from './dto/patch-tramite.dto';
import { ChangeEstadoDto } from './dto/change-estado.dto';
import { CancelDto } from './dto/cancel.dto';
import { ReabrirDto } from './dto/reabrir.dto';
import { UploadTramiteFileDto } from './dto/upload-tramite-file.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';

@ApiTags('Tramites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tramites')
export class TramitesController {
  constructor(private readonly service: TramitesService) { }

  @Get()
  async list(@Query() query: any) {
    return this.service.list(query);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('factura', {
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024 },
    }),
  )
  async create(
    @Body() dto: CreateTramiteDto,
    @UploadedFile() factura: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.service.createWithFactura(dto, factura, req.user.id);
  }

  @Get('atrasados')
  async atrasados() {
    return this.service.atrasados();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: PatchTramiteDto, @Req() req: any) {
    return this.service.patch(id, dto, req.user.id);
  }

  // Historial de estados
  @Get(':id/estados/historial')
  async historial(@Param('id') id: string) {
    return this.service.historial(id);
  }

  @Post(':id/estado')
  async changeEstado(@Param('id') id: string, @Body() dto: ChangeEstadoDto, @Req() req: any) {
    return this.service.changeEstado(id, dto.toEstado as any, dto.notes, req.user.id, dto.placa);
  }


  @Post(':id/finalizar')
  async finalizar(@Param('id') id: string, @Req() req: any) {
    return this.service.finalizar(id, req.user.id);
  }

  @Post(':id/cancelar')
  async cancelar(@Param('id') id: string, @Body() dto: CancelDto, @Req() req: any) {
    return this.service.cancelar(id, dto.reason, req.user.id);
  }

  @Post(':id/reabrir')
  async reabrir(@Param('id') id: string, @Body() dto: ReabrirDto, @Req() req: any) {
    return this.service.reabrir(id, dto.reason, (dto.toEstado as any) ?? undefined, req.user.id);
  }

  // Checklist
  @Get(':id/checklist')
  async checklist(@Param('id') id: string) {
    return this.service.checklist(id);
  }

  // Files del trámite
  @Get(':id/files')
  async listFiles(@Param('id') id: string) {
    return this.service.listFiles(id);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @Param('id') id: string,
    @Body() dto: UploadTramiteFileDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.service.uploadFile(id, dto, file, req.user.id);
  }

  @Get(':id/cuenta-cobro.pdf')
  async cuentaCobro(@Param('id') id: string, @Res() res: Response) {
    return this.service.cuentaCobroPdf(id, res);
  }
}
