import { Injectable } from '@nestjs/common';
import { Prisma, TramiteEstado } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsQueryDto } from './dto/reports-query.dto';

function parseDateStart(s: string) {
  return new Date(`${s}T00:00:00.000Z`);
}

function parseDateEnd(s: string) {
  return new Date(`${s}T23:59:59.999Z`);
}

function pad4(n: number) {
  return String(n).padStart(4, '0');
}

function displayId(year: number, code: string, consecutivo: number) {
  return `${year}-${code}-${pad4(consecutivo)}`;
}

function maxSummaryRows(): number {
  const raw = Number(process.env.REPORTS_SUMMARY_MAX_ROWS ?? 3000);
  if (!Number.isFinite(raw) || raw <= 0) return 3000;
  return raw;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(q: ReportsQueryDto): Prisma.TramiteWhereInput {
    const where: Prisma.TramiteWhereInput = {};
    const includeCancelados = String(q.includeCancelados ?? 'false') === 'true';

    if (!includeCancelados) where.estadoActual = { not: 'CANCELADO' };

    if (q.concesionarioCode) where.concesionarioCodeSnapshot = q.concesionarioCode;
    if (q.estado) where.estadoActual = q.estado as any;
    if (q.placa) where.placa = { contains: q.placa, mode: 'insensitive' };

    if (q.ciudad) where.ciudad = { is: { name: q.ciudad } };
    if (q.clienteDoc) where.cliente = { is: { doc: q.clienteDoc } };

    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as any).gte = parseDateStart(q.from);
      if (q.to) (where.createdAt as any).lte = parseDateEnd(q.to);
    }

    return where;
  }

  async tramites(q: ReportsQueryDto) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const skip = (page - 1) * pageSize;
    const where = this.buildWhere(q);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tramite.count({ where }),
      this.prisma.tramite.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          ciudad: { select: { name: true } },
          cliente: { select: { nombre: true, doc: true } },
          payments: { select: { valor: true } },
          shipmentLinks: { include: { shipment: { select: { costo: true } } } },
        },
      }),
    ]);

    const items = rows.map((t) => {
      const total_pagos = t.payments.reduce((a, p) => a + p.valor, 0);
      const total_envios = t.shipmentLinks.reduce((a, l) => a + l.shipment.costo, 0);
      const total_empresa = total_pagos + total_envios;

      return {
        id: t.id,
        display_id: displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
        year: t.year,
        concesionario_code: t.concesionarioCodeSnapshot,
        consecutivo: t.consecutivo,
        estado_actual: t.estadoActual,
        placa: t.placa,
        ciudad_nombre: t.ciudad.name,
        cliente_nombre: t.cliente.nombre,
        cliente_doc: t.cliente.doc,
        created_at: t.createdAt.toISOString(),
        total_pagos,
        total_envios,
        total_empresa,
      };
    });

    return { items, total, page, pageSize };
  }

  async summary(q: ReportsQueryDto) {
    const where = this.buildWhere(q);
    const maxRows = maxSummaryRows();
    const totalMatching = await this.prisma.tramite.count({ where });

    if (totalMatching > maxRows) {
      throw new AppError(
        'REPORT_RANGE_TOO_LARGE',
        `Resumen demasiado grande. Ajusta filtros o rango de fechas (max ${maxRows} tramites).`,
        { totalMatching, maxRows },
        422,
      );
    }

    const tramites = await this.prisma.tramite.findMany({
      where,
      select: {
        id: true,
        estadoActual: true,
        concesionarioCodeSnapshot: true,
        concesionario: { select: { name: true } },
        ciudad: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ids = tramites.map((t) => t.id);
    const pagosMap = await this.sumPagosByTramite(ids);
    const enviosMap = await this.sumEnviosByTramite(ids);
    const atrasadosCount = await this.countAtrasadosByIds(ids);

    let total_pagos = 0;
    let total_envios = 0;

    const byEstado = new Map<string, { estado: string; count: number; total_empresa: number }>();
    const byConcesionario = new Map<string, { code: string; name: string; count: number; total_empresa: number }>();
    const byCiudad = new Map<string, { name: string; count: number; total_empresa: number }>();

    for (const t of tramites) {
      const pagos = pagosMap.get(t.id) ?? 0;
      const envios = enviosMap.get(t.id) ?? 0;
      const total = pagos + envios;

      total_pagos += pagos;
      total_envios += envios;

      const estadoKey = t.estadoActual;
      const estado = byEstado.get(estadoKey);
      if (!estado) {
        byEstado.set(estadoKey, { estado: estadoKey, count: 1, total_empresa: total });
      } else {
        estado.count += 1;
        estado.total_empresa += total;
      }

      const code = t.concesionarioCodeSnapshot;
      const concesionario = byConcesionario.get(code);
      if (!concesionario) {
        byConcesionario.set(code, {
          code,
          name: t.concesionario?.name ?? code,
          count: 1,
          total_empresa: total,
        });
      } else {
        concesionario.count += 1;
        concesionario.total_empresa += total;
      }

      const cityName = t.ciudad?.name ?? 'SIN_CIUDAD';
      const city = byCiudad.get(cityName);
      if (!city) {
        byCiudad.set(cityName, { name: cityName, count: 1, total_empresa: total });
      } else {
        city.count += 1;
        city.total_empresa += total;
      }
    }

    const total_empresa = total_pagos + total_envios;

    return {
      range: { from: q.from ?? null, to: q.to ?? null },
      totals: {
        tramites: tramites.length,
        total_pagos,
        total_envios,
        total_empresa,
        atrasados: atrasadosCount,
      },
      byEstado: Array.from(byEstado.values()).sort((a, b) => b.total_empresa - a.total_empresa),
      byConcesionario: Array.from(byConcesionario.values()).sort((a, b) => b.total_empresa - a.total_empresa),
      byCiudad: Array.from(byCiudad.values()).sort((a, b) => b.total_empresa - a.total_empresa),
    };
  }

  private async sumPagosByTramite(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;

    const rows = await this.prisma.payment.groupBy({
      by: ['tramiteId'],
      where: { tramiteId: { in: ids } },
      _sum: { valor: true },
    });

    for (const row of rows) {
      map.set(row.tramiteId, row._sum.valor ?? 0);
    }
    return map;
  }

  private async sumEnviosByTramite(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;

    const rows = await this.prisma.shipmentTramite.findMany({
      where: { tramiteId: { in: ids } },
      select: {
        tramiteId: true,
        shipment: { select: { costo: true } },
      },
    });

    for (const row of rows) {
      const prev = map.get(row.tramiteId) ?? 0;
      map.set(row.tramiteId, prev + row.shipment.costo);
    }
    return map;
  }

  private async countAtrasadosByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const rules = await this.prisma.alertRule.findMany({ where: { isActive: true } });
    if (rules.length === 0) return 0;

    const hist = await this.prisma.tramiteEstadoHist.findMany({
      where: { tramiteId: { in: ids } },
      select: { tramiteId: true, toEstado: true, changedAt: true },
      orderBy: { changedAt: 'asc' },
    });

    const histMap = new Map<string, { toEstado: TramiteEstado; changedAt: Date }[]>();
    for (const h of hist) {
      const arr = histMap.get(h.tramiteId) ?? [];
      arr.push({ toEstado: h.toEstado, changedAt: h.changedAt });
      histMap.set(h.tramiteId, arr);
    }

    const now = Date.now();
    let count = 0;

    for (const id of ids) {
      const events = histMap.get(id) ?? [];
      let isLate = false;

      for (const r of rules) {
        const fromEvents = events.filter((e) => e.toEstado === r.fromEstado);
        if (fromEvents.length === 0) continue;

        const lastFrom = fromEvents[fromEvents.length - 1];
        const hasToAfter = events.some((e) => e.toEstado === r.toEstado && e.changedAt > lastFrom.changedAt);
        if (hasToAfter) continue;

        const days = Math.floor((now - lastFrom.changedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (days > r.thresholdDays) {
          isLate = true;
          break;
        }
      }

      if (isLate) count++;
    }

    return count;
  }
}
