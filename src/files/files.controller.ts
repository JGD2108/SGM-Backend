import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as path from 'path';
import { AppError } from '../common/errors/app-error';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function resolveContentType(storagePath: string) {
  const ext = path.extname(storagePath).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

function sanitizeDownloadName(name: string) {
  return name.replace(/[\\/\r\n"]/g, '_');
}

@ApiTags('Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const f = await this.prisma.tramiteFile.findUnique({ where: { id } });
    if (!f) throw new AppError('NOT_FOUND', 'Archivo no existe.', { id }, 404);

    const ext = path.extname(f.storagePath).toLowerCase();
    const fallbackName = `${f.docKey}_v${f.version}${ext}`;
    const preferred = (f.filenameOriginal ?? '').trim();
    const baseName = preferred.length > 0 ? preferred : fallbackName;
    const downloadName = path.extname(baseName) ? baseName : `${baseName}${ext}`;

    res.setHeader('Content-Type', resolveContentType(f.storagePath));
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeDownloadName(downloadName)}"`);

    const stream = this.storage.createStream(f.storagePath);
    stream.on('error', () => {
      res.status(404).json({
        errorCode: 'FILE_NOT_FOUND',
        message: 'No se encontro el archivo en storage.',
        details: {},
      });
    });

    stream.pipe(res);
  }
}
