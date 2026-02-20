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
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { TramitesService } from './tramites.service';
import { CancelDto } from './dto/cancel.dto';
import { ChangeEstadoDto } from './dto/change-estado.dto';
import { CreateTramiteDto } from './dto/create-tramite.dto';
import { PatchTramiteDto } from './dto/patch-tramite.dto';
import { ReabrirDto } from './dto/reabrir.dto';
import { UploadTramiteFileDto } from './dto/upload-tramite-file.dto';

const TMP_UPLOAD_DIR = path.join(os.tmpdir(), 'sgm-uploads');
const PDF_ONLY_MIME_TYPES = new Set(['application/pdf']);
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpg': '.jpg',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function maxUploadBytes() {
  const raw = Number(process.env.MAX_UPLOAD_MB ?? 20);
  const mb = Number.isFinite(raw) ? raw : 20;
  return mb * 1024 * 1024;
}

function extensionForUpload(file: Express.Multer.File) {
  const extFromName = path.extname(file.originalname ?? '').toLowerCase();
  if (extFromName) return extFromName;
  return MIME_EXTENSION_MAP[file.mimetype] ?? '.bin';
}

function uploadOptions(allowedMimeTypes: Set<string>) {
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
        cb(null, TMP_UPLOAD_DIR);
      },
      filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${randomUUID()}${extensionForUpload(file)}`);
      },
    }),
    limits: { fileSize: maxUploadBytes() },
    fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
      cb(null, allowedMimeTypes.has(file.mimetype));
    },
  };
}

@ApiTags('Tramites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tramites')
export class TramitesController {
  constructor(private readonly service: TramitesService) {}

  @Get()
  async list(@Query() query: any) {
    return this.service.list(query);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('factura', uploadOptions(PDF_ONLY_MIME_TYPES)))
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

  @Get(':id/checklist')
  async checklist(@Param('id') id: string) {
    return this.service.checklist(id);
  }

  @Get(':id/files')
  async listFiles(@Param('id') id: string) {
    return this.service.listFiles(id);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions(ALLOWED_UPLOAD_MIME_TYPES)))
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
