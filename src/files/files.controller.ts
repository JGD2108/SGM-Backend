import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../common/errors/app-error';
import type { Response } from 'express';

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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${f.docKey}_v${f.version}.pdf"`,
    );

    const stream = this.storage.createStream(f.storagePath);

    stream.on('error', () => {
      // Ojo: aquí no lances throw (no lo atrapa Nest). Responde directo:
      res.status(404).json({
        errorCode: 'FILE_NOT_FOUND',
        message: 'No se encontró el archivo en storage.',
        details: { storagePath: f.storagePath },
      });
    });

    stream.pipe(res);
  }
}
