import { Injectable } from '@nestjs/common';
import { Prisma, ServicioEstado, ServicioTipo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { CreateServicioPagoDto } from './dto/create-servicio-pago.dto';
import { PatchServicioDto } from './dto/patch-servicio.dto';
import { getServiceTemplates } from './service-templates';

function pad4(n: number) {
  return n.toString().padStart(4, '0');
}

function findSmallestMissing(sortedUsed: number[]): number {
  let expected = 1;
  for (const n of sortedUsed) {
    if (n === expected) expected++;
    else if (n > expected) break;
  }
  return expected;
}

@Injectable()
export class ServiciosService {
  constructor(private readonly prisma: PrismaService) {}

  private displayId(year: number, concesionarioCode: string, consecutivo: number) {
    return `${year}-${concesionarioCode}-${pad4(consecutivo)}`;
  }

  private assertNotMatriculaId(t: { tipoServicio: ServicioTipo; id?: string }) {
    if (t.tipoServicio === ServicioTipo.MATRICULA) {
      throw new AppError('VALIDATION_ERROR', 'Este id es una MATRÍCULA. Usa /tramites.', { id: t.id }, 400);
    }
  }

  private assertServicioNotLocked(t: { estadoServicio: ServicioEstado | null }) {
    if (t.estadoServicio === 'ENTREGADO' || t.estadoServicio === 'CANCELADO') {
      throw new AppError(
        'SERVICIO_LOCKED',
        'El servicio está ENTREGADO o CANCELADO. No se puede modificar.',
        { estado_servicio: t.estadoServicio },
        409,
      );
    }
  }

  private async reserveNextConsecutivo(concesionarioId: string, year: number) {
    const maxRetries = 6;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const used = await tx.consecutivoReserva.findMany({
              where: { concesionarioId, year, status: 'RESERVADO' },
              select: { consecutivo: true },
              orderBy: { consecutivo: 'asc' },
            });

            const next = findSmallestMissing(used.map((u) => u.consecutivo));

            const reserva = await tx.consecutivoReserva.create({
              data: { concesionarioId, year, consecutivo: next, status: 'RESERVADO' },
            });

            return reserva;
          },
          { isolationLevel: 'Serializable' as any },
        );
      } catch (e) {
        if (attempt === maxRetries) throw e;
      }
    }

    throw new AppError('CONSECUTIVO_ERROR', 'No se pudo asignar consecutivo.', {}, 500);
  }

  // Helper: Prisma JSON no acepta null directo
  private jsonOrDbNull(value: any): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    // null o undefined => DB NULL
    if (value == null) return Prisma.DbNull;
    return value as Prisma.InputJsonValue;
  }

  // ==========================
  // GET /servicios/templates
  // ==========================
  templates() {
    return { items: getServiceTemplates() };
  }

  // ==========================
  // POST /servicios
  // ==========================
  async create(dto: CreateServicioDto, userId: string) {
    if (dto.tipoServicio === ServicioTipo.MATRICULA) {
      throw new AppError('VALIDATION_ERROR', 'Para matrículas usa /tramites.', { tipoServicio: dto.tipoServicio }, 400);
    }

    const concesionario = await this.prisma.concesionario.findUnique({
      where: { code: dto.concesionarioCode },
    });
    if (!concesionario) {
      throw new AppError('VALIDATION_ERROR', 'Concesionario inválido.', { concesionarioCode: dto.concesionarioCode }, 400);
    }

    const ciudad = await this.prisma.ciudad.findUnique({ where: { name: dto.ciudad } });
    if (!ciudad) {
      throw new AppError('VALIDATION_ERROR', 'Ciudad inválida.', { ciudad: dto.ciudad }, 400);
    }

    const year = new Date().getFullYear();
    const reserva = await this.reserveNextConsecutivo(concesionario.id, year);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // cliente
        let cliente = await tx.cliente.findFirst({ where: { doc: dto.clienteDoc } });
        if (!cliente) {
          cliente = await tx.cliente.create({
            data: { doc: dto.clienteDoc, nombre: dto.clienteNombre },
          });
        } else if (cliente.nombre !== dto.clienteNombre) {
          cliente = await tx.cliente.update({
            where: { id: cliente.id },
            data: { nombre: dto.clienteNombre },
          });
        }

        const t = await tx.tramite.create({
          data: {
            year,
            concesionarioId: concesionario.id,
            concesionarioCodeSnapshot: concesionario.code,
            consecutivo: reserva.consecutivo,
            ciudadId: ciudad.id,
            clienteId: cliente.id,

            // compatible con matrícula, pero aquí NO se usa
            placa: null,
            estadoActual: 'FACTURA_RECIBIDA',

            tipoServicio: dto.tipoServicio as ServicioTipo,
            estadoServicio: 'RECIBIDO',

            // ✅ FIX: Json? no acepta null -> usar Prisma.DbNull
            serviceData: this.jsonOrDbNull(dto.serviceData),

            createdById: userId,
            gestorNombre: dto.gestorNombre ?? null,
            gestorTelefono: dto.gestorTelefono ?? null,
          },
        });

        await tx.consecutivoReserva.update({
          where: { id: reserva.id },
          data: { tramiteId: t.id, status: 'RESERVADO' },
        });

        await tx.servicioEstadoHist.create({
          data: {
            tramiteId: t.id,
            fromEstadoServicio: null,
            toEstadoServicio: 'RECIBIDO',
            changedById: userId,
            notes: 'Creación de servicio.',
            actionType: 'NORMAL',
          },
        });

        return t;
      });

      return {
        id: created.id,
        display_id: this.displayId(created.year, created.concesionarioCodeSnapshot, created.consecutivo),
        year: created.year,
        concesionario_code: created.concesionarioCodeSnapshot,
        consecutivo: created.consecutivo,
        tipo_servicio: created.tipoServicio,
        estado_servicio: created.estadoServicio,
      };
    } catch (e) {
      await this.prisma.consecutivoReserva.updateMany({
        where: { id: reserva.id, status: 'RESERVADO' },
        data: { status: 'LIBERADO', releasedAt: new Date(), tramiteId: null },
      });
      throw e;
    }
  }

  // ==========================
  // GET /servicios
  // ==========================
  async list(query: any) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const includeCancelados = String(query.includeCancelados ?? 'false') === 'true';

    const where: Prisma.TramiteWhereInput = {
      tipoServicio: { not: 'MATRICULA' },
    };

    if (!includeCancelados) {
      where.estadoServicio = { not: 'CANCELADO' } as any;
    }

    if (query.tipoServicio) where.tipoServicio = query.tipoServicio as ServicioTipo;
    if (query.estadoServicio) where.estadoServicio = query.estadoServicio as ServicioEstado;

    if (query.concesionarioCode) where.concesionarioCodeSnapshot = String(query.concesionarioCode);
    if (query.year) where.year = Number(query.year);
    if (query.consecutivo) where.consecutivo = Number(query.consecutivo);

    if (query.ciudad) where.ciudad = { is: { name: String(query.ciudad) } };
    if (query.clienteDoc) where.cliente = { is: { doc: String(query.clienteDoc) } };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.tramite.count({ where }),
      this.prisma.tramite.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          ciudad: { select: { name: true } },
          cliente: { select: { nombre: true, doc: true } },
        },
      }),
    ]);

    return {
      total,
      items: items.map((t) => ({
        id: t.id,
        display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
        year: t.year,
        concesionario_code: t.concesionarioCodeSnapshot,
        consecutivo: t.consecutivo,
        tipo_servicio: t.tipoServicio,
        estado_servicio: t.estadoServicio,
        ciudad_nombre: t.ciudad.name,
        cliente_nombre: t.cliente.nombre,
        cliente_doc: t.cliente.doc,
        gestor_nombre: t.gestorNombre,
        gestor_telefono: t.gestorTelefono,
        created_at: t.createdAt.toISOString(),
      })),
    };
  }

  // ==========================
  // GET /servicios/:id
  // ==========================
  async getById(id: string) {
    const t = await this.prisma.tramite.findUnique({
      where: { id },
      include: {
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        servicioPagos: true,
      },
    });

    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);
    this.assertNotMatriculaId(t);

    const total_pagos_servicio = t.servicioPagos.reduce((acc, p) => acc + p.valor, 0);

    return {
      id: t.id,
      display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
      year: t.year,
      concesionario_code: t.concesionarioCodeSnapshot,
      consecutivo: t.consecutivo,
      tipo_servicio: t.tipoServicio,
      estado_servicio: t.estadoServicio,
      ciudad_nombre: t.ciudad.name,
      cliente_nombre: t.cliente.nombre,
      cliente_doc: t.cliente.doc,
      gestor_nombre: t.gestorNombre,
      gestor_telefono: t.gestorTelefono,
      service_data: t.serviceData,
      pagos: t.servicioPagos.map((p) => ({
        id: p.id,
        concepto: p.concepto,
        valor: p.valor,
        created_at: p.createdAt.toISOString(),
      })),
      total_pagos_servicio,
    };
  }

  // ==========================
  // PATCH /servicios/:id
  // ==========================
  async patch(id: string, dto: PatchServicioDto, userId: string) {
    const t = await this.prisma.tramite.findUnique({
      where: { id },
      select: {
        id: true,
        year: true,
        concesionarioCodeSnapshot: true,
        consecutivo: true,
        tipoServicio: true,
        estadoServicio: true,
      },
    });

    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);
    this.assertNotMatriculaId(t);
    this.assertServicioNotLocked({ estadoServicio: t.estadoServicio ?? null });

    const gestorNombre = dto.gestorNombre !== undefined ? dto.gestorNombre.trim() : undefined;
    const gestorTelefono = dto.gestorTelefono !== undefined ? dto.gestorTelefono.trim() : undefined;

    const updated = await this.prisma.tramite.update({
      where: { id },
      data: {
        // ✅ Si mandan serviceData: null => limpiar DB (DbNull)
        ...(dto.serviceData !== undefined
          ? { serviceData: this.jsonOrDbNull(dto.serviceData) }
          : {}),

        ...(gestorNombre !== undefined ? { gestorNombre: gestorNombre.length ? gestorNombre : null } : {}),
        ...(gestorTelefono !== undefined ? { gestorTelefono: gestorTelefono.length ? gestorTelefono : null } : {}),
      },
      include: {
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        servicioPagos: true,
      },
    });

    const total_pagos_servicio = updated.servicioPagos.reduce((acc, p) => acc + p.valor, 0);

    return {
      id: updated.id,
      display_id: this.displayId(updated.year, updated.concesionarioCodeSnapshot, updated.consecutivo),
      year: updated.year,
      concesionario_code: updated.concesionarioCodeSnapshot,
      consecutivo: updated.consecutivo,
      tipo_servicio: updated.tipoServicio,
      estado_servicio: updated.estadoServicio,
      ciudad_nombre: updated.ciudad.name,
      cliente_nombre: updated.cliente.nombre,
      cliente_doc: updated.cliente.doc,
      gestor_nombre: updated.gestorNombre,
      gestor_telefono: updated.gestorTelefono,
      service_data: updated.serviceData,
      pagos: updated.servicioPagos.map((p) => ({
        id: p.id,
        concepto: p.concepto,
        valor: p.valor,
        created_at: p.createdAt.toISOString(),
      })),
      total_pagos_servicio,
    };
  }

  // ==========================
  // POST /servicios/:id/estado
  // ==========================
  async changeEstado(id: string, toEstado: ServicioEstado, notes: string | undefined, userId: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);
    this.assertNotMatriculaId(t);
    this.assertServicioNotLocked({ estadoServicio: t.estadoServicio ?? null });

    const valid = Object.values(ServicioEstado) as string[];
    if (!valid.includes(String(toEstado))) {
      throw new AppError('INVALID_STATE', 'Estado de servicio inválido.', { toEstado }, 400);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.servicioEstadoHist.create({
        data: {
          tramiteId: id,
          fromEstadoServicio: t.estadoServicio ?? null,
          toEstadoServicio: toEstado,
          changedById: userId,
          notes: notes ?? null,
          actionType: 'NORMAL',
        },
      });

      await tx.tramite.update({
        where: { id },
        data: {
          estadoServicio: toEstado,
          ...(toEstado === 'RADICADO' ? { radicadoAt: t.radicadoAt ?? new Date() } : {}),
          ...(toEstado === 'ENTREGADO' ? { finalizedAt: new Date() } : {}),
          ...(toEstado === 'CANCELADO' ? { canceledAt: new Date() } : {}),
        },
      });
    });

    return this.getById(id);
  }

  // ==========================
  // GET /servicios/:id/estados/historial
  // ==========================
  async historialEstados(id: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);

    const rows = await this.prisma.servicioEstadoHist.findMany({
      where: { tramiteId: id },
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { id: true, name: true, email: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      from_estado_servicio: r.fromEstadoServicio,
      to_estado_servicio: r.toEstadoServicio,
      changed_at: r.changedAt.toISOString(),
      changed_by: r.changedById,
      notes: r.notes,
      action_type: r.actionType,
    }));
  }

  // ==========================
  // POST /servicios/:id/pagos
  // ==========================
  async addPago(id: string, dto: CreateServicioPagoDto, userId: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);
    this.assertNotMatriculaId(t);
    this.assertServicioNotLocked({ estadoServicio: t.estadoServicio ?? null });

    const created = await this.prisma.servicioPago.create({
      data: {
        tramiteId: id,
        concepto: dto.concepto,
        valor: dto.valor,
        createdById: userId,
      },
    });

    return {
      id: created.id,
      tramite_id: created.tramiteId,
      concepto: created.concepto,
      valor: created.valor,
      created_at: created.createdAt.toISOString(),
    };
  }

  // ==========================
  // GET /servicios/:id/pagos
  // ==========================
  async listPagos(id: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Servicio no existe.', { id }, 404);

    const rows = await this.prisma.servicioPago.findMany({
      where: { tramiteId: id },
      orderBy: { createdAt: 'asc' },
    });

    const total = rows.reduce((acc, p) => acc + p.valor, 0);

    return {
      total,
      items: rows.map((p) => ({
        id: p.id,
        concepto: p.concepto,
        valor: p.valor,
        created_at: p.createdAt.toISOString(),
      })),
    };
  }
}
