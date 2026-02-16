import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../common/errors/app-error';
import { countPdfPages } from '../common/pdf/pdf.utils';
import { readFile, unlink } from 'fs/promises';
import { CreateTramiteDto } from './dto/create-tramite.dto';
import { PatchTramiteDto } from './dto/patch-tramite.dto';
import { UploadTramiteFileDto } from './dto/upload-tramite-file.dto';
import { Prisma, TramiteEstado, ActionType, ChecklistStatus, ConsecStatus, ServicioTipo } from '@prisma/client';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';

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
export class TramitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private maxPdfPages(): number {
    const raw = this.config.get<string>('MAX_PDF_PAGES') ?? '10';
    const n = Number(raw);
    return Number.isFinite(n) ? n : 10;
  }

  private maxUploadBytes(): number {
    const raw = this.config.get<string>('MAX_UPLOAD_MB') ?? '20';
    const mb = Number(raw);
    return (Number.isFinite(mb) ? mb : 20) * 1024 * 1024;
  }

  private displayId(year: number, concesionarioCode: string, consecutivo: number) {
    return `${year}-${concesionarioCode}-${pad4(consecutivo)}`;
  }

  // ✅ /tramites es SOLO MATRÍCULAS
  private assertIsMatricula(tramite: { tipoServicio?: any }) {
    const tipo = (tramite as any).tipoServicio;
    // Si es null/undefined lo tratamos como matrícula (compatibilidad si había datos viejos)
    if (tipo && tipo !== ServicioTipo.MATRICULA) {
      throw new AppError(
        'NOT_MATRICULA',
        'Este registro no es una matrícula. Usa /servicios.',
        { tipo_servicio: tipo },
        400,
      );
    }
  }

  private assertNotFinalized(tramite: { estadoActual: TramiteEstado }) {
    if (tramite.estadoActual === 'FINALIZADO_ENTREGADO') {
      throw new AppError('FINALIZED_LOCK', 'El trámite está finalizado. Debes reabrir para editar.', {}, 409);
    }
  }

  private assertNotCanceled(tramite: { estadoActual: TramiteEstado }) {
    if (tramite.estadoActual === 'CANCELADO') {
      throw new AppError('CANCELED_LOCK', 'El trámite está cancelado. No se puede modificar.', {}, 409);
    }
  }

  // ✅ Nuevo: lock único para cambio de estado (según tu regla nueva)
  private assertNotLockedForEstadoChange(tramite: { estadoActual: TramiteEstado }) {
    if (tramite.estadoActual === 'FINALIZADO_ENTREGADO' || tramite.estadoActual === 'CANCELADO') {
      throw new AppError(
        'TRAMITE_LOCKED',
        'El trámite está finalizado o cancelado. No se puede modificar.',
        { estado_actual: tramite.estadoActual },
        409,
      );
    }
  }

  private parseMoney(value: any): number | null {
    if (value === undefined) return null; // no viene -> no tocar
    if (value === null) return 0; // si mandan null, lo interpretamos como 0 (puedes cambiarlo)

    if (typeof value === 'number') return value;

    if (typeof value === 'string') {
      const cleaned = value.replace(/,/g, '').trim();
      if (cleaned.length === 0) return 0;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
  }

  private normalizePlaca(p: string) {
    return p.trim().toUpperCase();
  }

  private async validatePdfOrThrow(buffer: Buffer) {
    const pageCount = await countPdfPages(buffer);
    const max = this.maxPdfPages();
    if (pageCount > max) {
      throw new AppError('PDF_TOO_MANY_PAGES', `El PDF excede ${max} páginas.`, { pageCount, max }, 422);
    }
    return pageCount;
  }

  // ✅ Reserva el menor libre. Si hay choque, reintenta.
  private async getUploadBuffer(file: Express.Multer.File | undefined, field: string): Promise<Buffer> {
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Archivo PDF obligatorio.', { field }, 400);
    }
    if (file.buffer) return file.buffer;
    if (file.path) return readFile(file.path);
    throw new AppError('VALIDATION_ERROR', 'No se pudo leer el archivo cargado.', { field }, 400);
  }

  private async cleanupTempUpload(file?: Express.Multer.File) {
    if (!file?.path) return;
    await unlink(file.path).catch(() => undefined);
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
              data: {
                concesionarioId,
                year,
                consecutivo: next,
                status: 'RESERVADO',
              },
            });

            return reserva; // incluye consecutivo e id
          },
          { isolationLevel: 'Serializable' as any },
        );
      } catch (e: any) {
        if (attempt === maxRetries) throw e;
        // reintento por conflicto/serialización
      }
    }

    throw new AppError('CONSECUTIVO_ERROR', 'No se pudo asignar consecutivo.', {}, 500);
  }

  // ==========================
  // POST /tramites (multipart)
  // ==========================
  async createWithFactura(dto: CreateTramiteDto, facturaFile: Express.Multer.File, userId: string) {
    if (!facturaFile) {
      throw new AppError('VALIDATION_ERROR', 'La factura (PDF) es obligatoria.', { field: 'factura' }, 400);
    }
    if (facturaFile.mimetype !== 'application/pdf') {
      throw new AppError('VALIDATION_ERROR', 'La factura debe ser un PDF.', { mimetype: facturaFile.mimetype }, 400);
    }
    if (facturaFile.size > this.maxUploadBytes()) {
      throw new AppError('UPLOAD_TOO_LARGE', 'Archivo demasiado grande.', {}, 413);
    }

    const facturaBuffer = await this.getUploadBuffer(facturaFile, 'factura');
    const pageCount = await this.validatePdfOrThrow(facturaBuffer);

    // catálogos
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

    // 1) Reservar consecutivo (transacción)
    const reserva = await this.reserveNextConsecutivo(concesionario.id, year);
    const consecutivo = reserva.consecutivo;

    // 2) Escribir factura al disco ANTES de crear el trámite (para evitar trámite sin PDF)
    const filename = `FACTURA_v1.pdf`;
    const storagePath = this.storage.buildRelativePath(year, concesionario.code, consecutivo, filename);

    try {
      await this.storage.writeFile(storagePath, facturaBuffer);

      // 3) Crear trámite + checklist + file record + historial y amarrar reserva
      const result = await this.prisma.$transaction(async (tx) => {
        // cliente (no es unique, entonces hacemos findFirst)
        let cliente = await tx.cliente.findFirst({ where: { doc: dto.clienteDoc } });
        if (!cliente) {
          cliente = await tx.cliente.create({
            data: { doc: dto.clienteDoc, nombre: dto.clienteNombre },
          });
        } else {
          // opcional: actualiza nombre si cambió
          if (cliente.nombre !== dto.clienteNombre) {
            cliente = await tx.cliente.update({
              where: { id: cliente.id },
              data: { nombre: dto.clienteNombre },
            });
          }
        }

        const tramite = await tx.tramite.create({
          data: {
            year,
            concesionarioId: concesionario.id,
            concesionarioCodeSnapshot: concesionario.code,
            consecutivo,
            ciudadId: ciudad.id,
            clienteId: cliente.id,

            // ✅ regla nueva: placa NO existe al crear
            placa: null,
            estadoActual: 'FACTURA_RECIBIDA',

            // ✅ IMPORTANTE: esto es matrícula
            tipoServicio: ServicioTipo.MATRICULA,
            estadoServicio: null,
            createdById: userId,
          },
        });

        // amarrar reserva al trámite
        await tx.consecutivoReserva.update({
          where: { id: reserva.id },
          data: { tramiteId: tramite.id, status: 'RESERVADO' },
        });

        // checklist snapshot (desde DocumentType activo)
        const docTypes = await tx.documentType.findMany({ where: { isActive: true } });
        for (const dt of docTypes) {
          const isFactura = dt.key === 'FACTURA';
          await tx.tramiteDocument.create({
            data: {
              tramiteId: tramite.id,
              documentTypeId: dt.id,
              docKey: dt.key,
              nameSnapshot: dt.name,
              required: dt.required,
              status: isFactura ? 'RECIBIDO' : 'PENDIENTE',
              receivedAt: isFactura ? new Date() : null,
            },
          });
        }

        // file record (FACTURA v1)
        await tx.tramiteFile.create({
          data: {
            tramiteId: tramite.id,
            docKey: 'FACTURA',
            documentTypeId: (await tx.documentType.findUnique({ where: { key: 'FACTURA' } }))?.id ?? null,
            filenameOriginal: facturaFile.originalname,
            storagePath,
            pageCount,
            version: 1,
            uploadedById: userId,
          },
        });

        // historial inicial
        await tx.tramiteEstadoHist.create({
          data: {
            tramiteId: tramite.id,
            fromEstado: null,
            toEstado: 'FACTURA_RECIBIDA',
            changedById: userId,
            notes: 'Creación de trámite con factura.',
            actionType: 'NORMAL',
          },
        });

        return tramite;
      });

      return {
        id: result.id,
        display_id: this.displayId(year, concesionario.code, consecutivo),
        year,
        concesionario_code: concesionario.code,
        consecutivo,
      };
    } catch (e) {
      // compensación si algo falla
      await this.storage.deleteFileIfExists(storagePath);
      await this.prisma.consecutivoReserva.updateMany({
        where: { id: reserva.id, status: 'RESERVADO' },
        data: { status: 'LIBERADO', releasedAt: new Date(), tramiteId: null },
      });
      throw e;
    } finally {
      await this.cleanupTempUpload(facturaFile);
    }
  }

  // ==========================
  // GET /tramites (bandeja)
  // ==========================
  async list(query: any) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const includeCancelados = String(query.includeCancelados ?? 'false') === 'true';

    const where: Prisma.TramiteWhereInput = {
      // ✅ /tramites = SOLO MATRÍCULAS
      tipoServicio: ServicioTipo.MATRICULA,
    };

    if (!includeCancelados) {
      where.estadoActual = { not: 'CANCELADO' };
    }

    if (query.placa) where.placa = { contains: String(query.placa), mode: 'insensitive' };
    if (query.year) where.year = Number(query.year);
    if (query.concesionarioCode) where.concesionarioCodeSnapshot = String(query.concesionarioCode);
    if (query.consecutivo) where.consecutivo = Number(query.consecutivo);
    if (query.estado) where.estadoActual = query.estado as TramiteEstado;

    if (query.ciudad) where.ciudad = { is: { name: String(query.ciudad) } };
    if (query.clienteDoc) where.cliente = { is: { doc: String(query.clienteDoc) } };

    if (query.createdFrom || query.createdTo) {
      where.createdAt = {};
      if (query.createdFrom) (where.createdAt as any).gte = new Date(`${query.createdFrom}T00:00:00.000Z`);
      if (query.createdTo) (where.createdAt as any).lte = new Date(`${query.createdTo}T23:59:59.999Z`);
    }

    const [total, tramites] = await this.prisma.$transaction([
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

    // is_atrasado (MVP): calcula con alert rules + historial
    const ids = tramites.map((t) => t.id);
    const rules = await this.prisma.alertRule.findMany({ where: { isActive: true } });
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

    function isAtrasado(tramiteId: string): boolean {
      const events = histMap.get(tramiteId) ?? [];
      const now = Date.now();

      for (const r of rules) {
        const fromEvents = events.filter((e) => e.toEstado === r.fromEstado);
        if (fromEvents.length === 0) continue;

        const lastFrom = fromEvents[fromEvents.length - 1];
        const hasToAfter = events.some((e) => e.toEstado === r.toEstado && e.changedAt > lastFrom.changedAt);
        if (hasToAfter) continue;

        const days = Math.floor((now - lastFrom.changedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (days > r.thresholdDays) return true;
      }
      return false;
    }

    return {
      items: tramites.map((t) => ({
        id: t.id,
        display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
        year: t.year,
        concesionario_code: t.concesionarioCodeSnapshot,
        consecutivo: t.consecutivo,
        estado_actual: t.estadoActual,
        placa: t.placa,
        ciudad_nombre: t.ciudad.name,
        cliente_nombre: t.cliente.nombre,
        cliente_doc: t.cliente.doc,
        created_at: t.createdAt.toISOString(),
        is_atrasado: isAtrasado(t.id),
      })),
      total,
    };
  }

  // ==========================
  // GET /tramites/:id
  // ==========================
  async getById(id: string) {
    const t = await this.prisma.tramite.findUnique({
      where: { id },
      include: {
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        payments: { select: { valor: true } },
        shipmentLinks: { include: { shipment: { select: { costo: true } } } },
      },
    });

    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    // is_atrasado (mismo cálculo pero por 1 trámite)
    const rules = await this.prisma.alertRule.findMany({ where: { isActive: true } });
    const events = await this.prisma.tramiteEstadoHist.findMany({
      where: { tramiteId: id },
      select: { toEstado: true, changedAt: true },
      orderBy: { changedAt: 'asc' },
    });

    const now = Date.now();
    let is_atrasado = false;
    for (const r of rules) {
      const fromEvents = events.filter((e) => e.toEstado === r.fromEstado);
      if (fromEvents.length === 0) continue;
      const lastFrom = fromEvents[fromEvents.length - 1];
      const hasToAfter = events.some((e) => e.toEstado === r.toEstado && e.changedAt > lastFrom.changedAt);
      if (hasToAfter) continue;
      const days = Math.floor((now - lastFrom.changedAt.getTime()) / (1000 * 60 * 60 * 24));
      if (days > r.thresholdDays) {
        is_atrasado = true;
        break;
      }
    }

    const total_pagos = t.payments.reduce((acc, p) => acc + p.valor, 0);
    const total_envios = t.shipmentLinks.reduce((acc, l) => acc + l.shipment.costo, 0);
    const total_empresa = total_pagos + total_envios;

    const honorarios = Number((t as any).honorariosValor ?? 0);
    const total_final = total_empresa + honorarios;

    return {
      id: t.id,
      display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
      year: t.year,
      concesionario_code: t.concesionarioCodeSnapshot,
      consecutivo: t.consecutivo,
      estado_actual: t.estadoActual,
      placa: t.placa,
      ciudad_nombre: t.ciudad.name,
      cliente_nombre: t.cliente.nombre,
      cliente_doc: t.cliente.doc,
      is_atrasado,
      finalized_at: t.finalizedAt ? t.finalizedAt.toISOString() : null,
      canceled_at: t.canceledAt ? t.canceledAt.toISOString() : null,
      total_pagos,
      total_envios,
      total_empresa,
      honorarios_valor: honorarios,
      total_final,
    };
  }

  // ==========================
  // PATCH /tramites/:id
  // ==========================
  async patch(id: string, dto: PatchTramiteDto, userId: string) {
    const t = await this.prisma.tramite.findUnique({
      where: { id },
      include: { concesionario: true, ciudad: true },
    });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    this.assertNotCanceled(t);
    this.assertNotFinalized(t);

    // ✅ honorarios (si viene)
    const honorariosParsed = this.parseMoney((dto as any).honorariosValor);
    if (honorariosParsed !== null) {
      if (!Number.isFinite(honorariosParsed)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'honorariosValor inválido.',
          { honorariosValor: (dto as any).honorariosValor },
          400,
        );
      }
      if (honorariosParsed < 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'honorariosValor no puede ser negativo.',
          { honorariosValor: honorariosParsed },
          400,
        );
      }
    }

    let ciudadId = t.ciudadId;
    if (dto.ciudad) {
      const ciudad = await this.prisma.ciudad.findUnique({ where: { name: dto.ciudad } });
      if (!ciudad) throw new AppError('VALIDATION_ERROR', 'Ciudad inválida.', { ciudad: dto.ciudad }, 400);
      ciudadId = ciudad.id;
    }

    // Cambio de concesionario (reasigna consecutivo y guarda anterior)
    if (dto.concesionarioCode && dto.concesionarioCode !== t.concesionarioCodeSnapshot) {
      const nuevo = await this.prisma.concesionario.findUnique({ where: { code: dto.concesionarioCode } });
      if (!nuevo) throw new AppError('VALIDATION_ERROR', 'Concesionario inválido.', { concesionarioCode: dto.concesionarioCode }, 400);

      const reservaNueva = await this.reserveNextConsecutivo(nuevo.id, t.year);

      await this.prisma.$transaction(async (tx) => {
        // liberar reserva anterior (si existe)
        await tx.consecutivoReserva.updateMany({
          where: { tramiteId: t.id, status: 'RESERVADO' },
          data: { status: 'LIBERADO', releasedAt: new Date(), tramiteId: null },
        });

        // amarrar la nueva reserva al tramite
        await tx.consecutivoReserva.update({
          where: { id: reservaNueva.id },
          data: { tramiteId: t.id, status: 'RESERVADO' },
        });

        await tx.tramite.update({
          where: { id: t.id },
          data: {
            concesionarioAnteriorId: t.concesionarioId,
            consecutivoAnterior: t.consecutivo,
            concesionarioId: nuevo.id,
            concesionarioCodeSnapshot: nuevo.code,
            consecutivo: reservaNueva.consecutivo,
            ciudadId,

            // ✅ placa no se cambia por PATCH (regla nueva)

            ...(honorariosParsed !== null ? { honorariosValor: honorariosParsed as any } : {}),
          },
        });

        // historial (opcional)
        await tx.tramiteEstadoHist.create({
          data: {
            tramiteId: t.id,
            fromEstado: t.estadoActual,
            toEstado: t.estadoActual,
            changedById: userId,
            notes: `Cambio de concesionario a ${nuevo.code}. Reasignado consecutivo.`,
            actionType: 'NORMAL',
          },
        });
      });

      return this.getById(t.id);
    }

    // patch normal (sin cambio de concesionario)
    await this.prisma.tramite.update({
      where: { id },
      data: {
        ciudadId,
        ...(honorariosParsed !== null ? { honorariosValor: honorariosParsed as any } : {}),
      },
    });

    return this.getById(id);
  }

  // ==========================
  // Estados + historial
  // ==========================
  async historial(id: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    const rows = await this.prisma.tramiteEstadoHist.findMany({
      where: { tramiteId: id },
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { id: true, name: true, email: true } } },
    });

    return rows.map((r) => ({
      id: r.id,
      from_estado: r.fromEstado,
      to_estado: r.toEstado,
      changed_at: r.changedAt.toISOString(),
      changed_by: r.changedById,
      notes: r.notes,
      action_type: r.actionType,
    }));
  }

  // ✅ CAMBIO PRINCIPAL: ahora soporta placa atómica por estado
  async changeEstado(
    id: string,
    toEstadoRaw: any,
    notes: string | undefined,
    userId: string,
    placa?: string,
  ) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    // lock (finalizado/cancelado)
    this.assertNotLockedForEstadoChange(t);

    // validar estado
    const toEstado = String(toEstadoRaw) as TramiteEstado;
    const validStates = Object.values(TramiteEstado) as string[];
    if (!validStates.includes(toEstado)) {
      throw new AppError('INVALID_STATE', 'Estado inválido.', { toEstado }, 400);
    }

    // validación por estado: placa obligatoria en PLACA_ASIGNADA
    let placaNormalized: string | undefined = undefined;

    if (toEstado === 'PLACA_ASIGNADA') {
      if (!placa || placa.trim().length === 0) {
        throw new AppError(
          'PLACA_REQUIRED_FOR_STATE',
          'La placa es obligatoria para el estado PLACA_ASIGNADA.',
          { toEstado },
          422,
        );
      }
      placaNormalized = this.normalizePlaca(placa);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tramiteEstadoHist.create({
        data: {
          tramiteId: id,
          fromEstado: t.estadoActual,
          toEstado,
          changedById: userId,
          notes: notes ?? null,
          actionType: 'NORMAL',
        },
      });

      await tx.tramite.update({
        where: { id },
        data: {
          estadoActual: toEstado,
          ...(placaNormalized ? { placa: placaNormalized } : {}),
        },
      });
    });

    return this.getById(id);
  }

  async finalizar(id: string, userId: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    this.assertNotCanceled(t);

    if (t.estadoActual === 'FINALIZADO_ENTREGADO') {
      throw new AppError('CONFLICT', 'Ya está finalizado.', {}, 409);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tramiteEstadoHist.create({
        data: {
          tramiteId: id,
          fromEstado: t.estadoActual,
          toEstado: 'FINALIZADO_ENTREGADO',
          changedById: userId,
          notes: 'Finalizado.',
          actionType: 'FINALIZAR',
        },
      });

      await tx.tramite.update({
        where: { id },
        data: { estadoActual: 'FINALIZADO_ENTREGADO', finalizedAt: new Date() },
      });
    });

    return this.getById(id);
  }

  async cancelar(id: string, reason: string | undefined, userId: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    if (t.estadoActual === 'CANCELADO') {
      throw new AppError('CONFLICT', 'Ya está cancelado.', {}, 409);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tramiteEstadoHist.create({
        data: {
          tramiteId: id,
          fromEstado: t.estadoActual,
          toEstado: 'CANCELADO',
          changedById: userId,
          notes: reason ?? null,
          actionType: 'CANCELAR',
        },
      });

      await tx.tramite.update({
        where: { id },
        data: { estadoActual: 'CANCELADO', canceledAt: new Date() },
      });

      await tx.consecutivoReserva.updateMany({
        where: { tramiteId: id, status: 'RESERVADO' },
        data: { status: 'LIBERADO', releasedAt: new Date(), tramiteId: null },
      });
    });

    return this.getById(id);
  }

  async reabrir(id: string, reason: string, toEstado: TramiteEstado | undefined, userId: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    this.assertNotCanceled(t);

    if (t.estadoActual !== 'FINALIZADO_ENTREGADO') {
      throw new AppError('CONFLICT', 'Solo se puede reabrir si está finalizado.', {}, 409);
    }

    const target: TramiteEstado = toEstado ?? 'DOCS_FISICOS_PENDIENTES';

    await this.prisma.$transaction(async (tx) => {
      await tx.tramiteEstadoHist.create({
        data: {
          tramiteId: id,
          fromEstado: t.estadoActual,
          toEstado: target,
          changedById: userId,
          notes: reason,
          actionType: 'REABRIR',
        },
      });

      await tx.tramite.update({
        where: { id },
        data: { estadoActual: target, finalizedAt: null },
      });
    });

    return this.getById(id);
  }

  // ==========================
  // Checklist
  // ==========================
  async checklist(id: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    const rows = await this.prisma.tramiteDocument.findMany({
      where: { tramiteId: id },
      orderBy: { nameSnapshot: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      docKey: r.docKey,
      name: r.nameSnapshot,
      required: r.required,
      status: r.status,
      received_at: r.receivedAt ? r.receivedAt.toISOString() : null,
    }));
  }

  // ==========================
  // Files list + upload
  // ==========================
  async listFiles(id: string) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    const files = await this.prisma.tramiteFile.findMany({
      where: { tramiteId: id },
      orderBy: [{ docKey: 'asc' }, { version: 'asc' }],
    });

    return files.map((f) => ({
      id: f.id,
      docKey: f.docKey,
      version: f.version,
      uploaded_at: f.uploadedAt.toISOString(),
      page_count: f.pageCount,
      filename_original: f.filenameOriginal,
    }));
  }

  async uploadFile(tramiteId: string, dto: UploadTramiteFileDto, file: Express.Multer.File, userId: string) {
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Archivo PDF obligatorio.', { field: 'file' }, 400);
    }
    if (file.mimetype !== 'application/pdf') {
      throw new AppError('VALIDATION_ERROR', 'El archivo debe ser PDF.', { mimetype: file.mimetype }, 400);
    }
    if (file.size > this.maxUploadBytes()) {
      throw new AppError('UPLOAD_TOO_LARGE', 'Archivo demasiado grande.', {}, 413);
    }

    const tramite = await this.prisma.tramite.findUnique({ where: { id: tramiteId } });
    if (!tramite) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: tramiteId }, 404);
    this.assertIsMatricula(tramite);

    this.assertNotCanceled(tramite);
    this.assertNotFinalized(tramite);

    const docType = await this.prisma.documentType.findUnique({ where: { key: dto.docKey } });
    if (!docType) throw new AppError('VALIDATION_ERROR', 'docKey inválido.', { docKey: dto.docKey }, 400);

    const fileBuffer = await this.getUploadBuffer(file, 'file');
    const pageCount = await this.validatePdfOrThrow(fileBuffer);

    const last = await this.prisma.tramiteFile.findFirst({
      where: { tramiteId, docKey: dto.docKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const filename = `${dto.docKey}_v${version}.pdf`;
    const storagePath = this.storage.buildRelativePath(
      tramite.year,
      tramite.concesionarioCodeSnapshot,
      tramite.consecutivo,
      filename,
    );

    try {
      await this.storage.writeFile(storagePath, fileBuffer);

      const created = await this.prisma.$transaction(async (tx) => {
        const f = await tx.tramiteFile.create({
          data: {
            tramiteId,
            docKey: dto.docKey,
            documentTypeId: docType.id,
            filenameOriginal: file.originalname,
            storagePath,
            pageCount,
            version,
            uploadedById: userId,
          },
        });

        // marcar checklist como recibido si existe
        await tx.tramiteDocument.updateMany({
          where: { tramiteId, docKey: dto.docKey },
          data: { status: 'RECIBIDO', receivedAt: new Date() },
        });

        return f;
      });

      return {
        id: created.id,
        tramite_id: created.tramiteId,
        docKey: created.docKey,
        filename_original: created.filenameOriginal,
        version: created.version,
        page_count: created.pageCount,
        uploaded_at: created.uploadedAt.toISOString(),
        storage_path: created.storagePath,
      };
    } catch (e) {
      await this.storage.deleteFileIfExists(storagePath);
      throw e;
    } finally {
      await this.cleanupTempUpload(file);
    }
  }

  async atrasados() {
    const rules = await this.prisma.alertRule.findMany({ where: { isActive: true } });

    const tramites = await this.prisma.tramite.findMany({
      where: {
        estadoActual: { not: 'CANCELADO' },
        // ✅ SOLO MATRÍCULAS
        tipoServicio: ServicioTipo.MATRICULA,
      },
      include: {
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ids = tramites.map((t) => t.id);

    const hist = await this.prisma.tramiteEstadoHist.findMany({
      where: { tramiteId: { in: ids } },
      select: { tramiteId: true, toEstado: true, changedAt: true },
      orderBy: { changedAt: 'asc' },
    });

    const histMap = new Map<string, { toEstado: any; changedAt: Date }[]>();
    for (const h of hist) {
      const arr = histMap.get(h.tramiteId) ?? [];
      arr.push({ toEstado: h.toEstado, changedAt: h.changedAt });
      histMap.set(h.tramiteId, arr);
    }

    const now = Date.now();
    const out: any[] = [];

    for (const t of tramites) {
      const events = histMap.get(t.id) ?? [];

      let worst: { ruleText: string; daysLate: number } | null = null;

      for (const r of rules) {
        const fromEvents = events.filter((e) => e.toEstado === r.fromEstado);
        if (fromEvents.length === 0) continue;

        const lastFrom = fromEvents[fromEvents.length - 1];
        const hasToAfter = events.some((e) => e.toEstado === r.toEstado && e.changedAt > lastFrom.changedAt);
        if (hasToAfter) continue;

        const days = Math.floor((now - lastFrom.changedAt.getTime()) / (1000 * 60 * 60 * 24));
        const daysLate = days - r.thresholdDays;

        if (daysLate > 0) {
          const text = `${r.fromEstado} -> ${r.toEstado} > ${r.thresholdDays} días`;
          if (!worst || daysLate > worst.daysLate) worst = { ruleText: text, daysLate };
        }
      }

      if (worst) {
        out.push({
          tramite: {
            id: t.id,
            display_id: `${t.year}-${t.concesionarioCodeSnapshot}-${String(t.consecutivo).padStart(4, '0')}`,
            year: t.year,
            concesionario_code: t.concesionarioCodeSnapshot,
            consecutivo: t.consecutivo,
            estado_actual: t.estadoActual,
            placa: t.placa,
            ciudad_nombre: t.ciudad.name,
            cliente_nombre: t.cliente.nombre,
            cliente_doc: t.cliente.doc,
            created_at: t.createdAt.toISOString(),
            is_atrasado: true,
          },
          rule: worst.ruleText,
          daysLate: worst.daysLate,
        });
      }
    }

    return out;
  }

  async cuentaCobroPdf(tramiteId: string, res: Response) {
    const t = await this.prisma.tramite.findUnique({
      where: { id: tramiteId },
      include: {
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        payments: true,
        shipmentLinks: { include: { shipment: true } },
      },
    });

    if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: tramiteId }, 404);
    this.assertIsMatricula(t);

    const totalPagos = t.payments.reduce((acc, p) => acc + p.valor, 0);
    const totalEnvios = t.shipmentLinks.reduce((acc, l) => acc + l.shipment.costo, 0);
    const subtotalEmpresa = totalPagos + totalEnvios;

    const honorarios = Number((t as any).honorariosValor ?? 0);
    const totalFinal = subtotalEmpresa + honorarios;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cuenta-cobro-${t.year}-${t.concesionarioCodeSnapshot}-${String(t.consecutivo).padStart(4, '0')}.pdf"`,
    );

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).text('Cuenta de cobro', { align: 'center' });
    doc.moveDown();

    const displayId = `${t.year}-${t.concesionarioCodeSnapshot}-${String(t.consecutivo).padStart(4, '0')}`;
    doc.fontSize(12).text(`Trámite: ${displayId}`);
    doc.text(`Cliente: ${t.cliente.nombre} (${t.cliente.doc})`);
    doc.text(`Ciudad: ${t.ciudad.name}`);
    doc.text(`Estado: ${t.estadoActual}`);
    doc.moveDown();

    doc.fontSize(14).text('Detalle de costos');
    doc.moveDown(0.5);

    doc.fontSize(12).text(`Pagos registrados: $${totalPagos.toLocaleString('es-CO')}`);
    doc.text(`Envíos (guías): $${totalEnvios.toLocaleString('es-CO')}`);
    doc.moveDown();

    doc.fontSize(12).text(`Subtotal empresa: $${subtotalEmpresa.toLocaleString('es-CO')}`);
    doc.text(`Honorarios: $${honorarios.toLocaleString('es-CO')}`);
    doc.moveDown();

    doc.fontSize(14).text(`TOTAL FINAL: $${totalFinal.toLocaleString('es-CO')}`, { underline: true });
    doc.moveDown();

    doc.fontSize(10).text(`Generado: ${new Date().toISOString().slice(0, 10)}`);

    doc.end();
  }
}
