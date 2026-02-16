import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ReportsQueryDto } from './dto/reports-query.dto';
import { ReportsService } from './reports.service';

function sanitizeCsvCell(value: unknown): string {
  const s = String(value ?? '');
  const t = s.trimStart();
  if (t.startsWith('=') || t.startsWith('+') || t.startsWith('-') || t.startsWith('@')) {
    return `'${s}`;
  }
  return s;
}

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('summary')
  async summary(@Query() q: ReportsQueryDto) {
    return this.service.summary(q);
  }

  @Get('tramites')
  async tramites(@Query() q: ReportsQueryDto) {
    return this.service.tramites(q);
  }

  @Get('export.csv')
  async exportCsv(@Query() q: ReportsQueryDto, @Res() res: Response) {
    const data = await this.service.tramites({ ...q, page: 1, pageSize: 200 });

    const headers = [
      'display_id',
      'estado_actual',
      'placa',
      'concesionario_code',
      'consecutivo',
      'cliente_doc',
      'cliente_nombre',
      'ciudad',
      'created_at',
      'total_pagos',
      'total_envios',
      'total_empresa',
    ];

    const lines = [headers.join(',')];
    for (const it of data.items) {
      const row = [
        sanitizeCsvCell(it.display_id),
        sanitizeCsvCell(it.estado_actual),
        sanitizeCsvCell(it.placa ?? ''),
        sanitizeCsvCell(it.concesionario_code),
        sanitizeCsvCell(String(it.consecutivo)),
        sanitizeCsvCell(it.cliente_doc),
        sanitizeCsvCell(it.cliente_nombre),
        sanitizeCsvCell(it.ciudad_nombre),
        sanitizeCsvCell(it.created_at),
        sanitizeCsvCell(String(it.total_pagos)),
        sanitizeCsvCell(String(it.total_envios)),
        sanitizeCsvCell(String(it.total_empresa)),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);

      lines.push(row.join(','));
    }

    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-tramites.csv"');
    res.send(csv);
  }
}
