import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { ReportsService } from './reports.service';
import { ReportsQueryDto } from './dto/reports-query.dto';
import type { Response } from 'express';

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

    // CSV simple (MVP)
    const headers = [
      'display_id','estado_actual','placa','concesionario_code','consecutivo',
      'cliente_doc','cliente_nombre','ciudad','created_at',
      'total_pagos','total_envios','total_empresa'
    ];

    const lines = [headers.join(',')];

    for (const it of data.items) {
      const row = [
        it.display_id,
        it.estado_actual,
        it.placa ?? '',
        it.concesionario_code,
        String(it.consecutivo),
        it.cliente_doc,
        it.cliente_nombre,
        it.ciudad_nombre,
        it.created_at,
        String(it.total_pagos),
        String(it.total_envios),
        String(it.total_empresa),
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);

      lines.push(row.join(','));
    }

    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte-tramites.csv"');
    res.send(csv);
  }
}
