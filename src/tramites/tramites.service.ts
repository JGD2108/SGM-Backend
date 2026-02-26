import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../storage/storage.service';
import { AppError } from '../common/errors/app-error';
import { countPdfPages } from '../common/pdf/pdf.utils';
import { readFile, unlink } from 'fs/promises';
import * as path from 'path';
import {
  CUENTA_COBRO_CONCEPTS,
  CUENTA_COBRO_PDF_COORDS,
  findCuentaCobroConcept,
  findCuentaCobroConceptById,
  resolveCuentaCobroServiceName,
} from './cuenta-cobro.config';
import { CreateTramiteDto } from './dto/create-tramite.dto';
import { PatchTramiteDto } from './dto/patch-tramite.dto';
import { SaveCuentaCobroPagosDto } from './dto/save-cuenta-cobro-pagos.dto';
import { SetCuentaCobroBaseDto } from './dto/set-cuenta-cobro-base.dto';
import { UploadTramiteFileDto } from './dto/upload-tramite-file.dto';
import {
  Prisma,
  TramiteEstado,
  ActionType,
  ChecklistStatus,
  ConsecStatus,
  ServicioTipo,
  MedioPago,
} from '@prisma/client';
import type { Response } from 'express';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
const CLIENTE_MATCH_SPANISH_UPPER_ACCENTS = '\u00C1\u00C0\u00C4\u00C2\u00C3\u00C9\u00C8\u00CB\u00CA\u00CD\u00CC\u00CF\u00CE\u00D3\u00D2\u00D6\u00D4\u00D5\u00DA\u00D9\u00DC\u00DB\u00D1\u00C7';
const CLIENTE_MATCH_ASCII_UPPER_EQUIVALENTS = 'AAAAAEEEEIIIIOOOOOUUUUNC';
type ClienteMatchRow = {
  id: string;
  doc: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
};
function trimOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}
function normalizeClienteDocKey(value: string | undefined): string | null {
  const s = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}
function normalizeClienteNameKey(value: string | undefined): string | null {
  const s = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}
const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MIME_EXTENSION_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpg': 'jpg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const FLEXIBLE_DOC_KEYS = ['OTRO', 'DOCS_FISICOS', 'DOC_FISICO'] as const;
const FLEXIBLE_DOC_KEY_SET = new Set<string>(FLEXIBLE_DOC_KEYS);
const FLEXIBLE_DOC_TYPE_PREFERENCE = ['OTRO', 'DOC_FISICO', 'DOCS_FISICOS'] as const;
const FALLBACK_FLEXIBLE_NAME = 'Otros documentos';

type CuentaCobroTramiteRecord = {
  id: string;
  year: number;
  placa: string | null;
  tipoServicio: ServicioTipo;
  serviceData: Prisma.JsonValue | null;
  estadoActual: TramiteEstado;
  honorariosValor: Prisma.Decimal | null;
  cuentaCobroConcepto: string | null;
  cuentaCobroValor: Prisma.Decimal | null;
  cuentaCobroAbono: Prisma.Decimal | null;
  cuentaCobroFecha: Date | null;
  cuentaCobroServiceId: string | null;
  cuentaCobroClienteNombre: string | null;
  cuentaCobroClienteDoc: string | null;
  cuentaCobroPlaca: string | null;
  cuentaCobroCiudad: string | null;
  cuentaCobroConcesionario: string | null;
  concesionarioCodeSnapshot: string;
  consecutivo: number;
  concesionario: { name: string } | null;
  ciudad: { name: string };
  cliente: { nombre: string; doc: string };
  payments: Array<{
    id: string;
    tipo: any;
    valor: number;
    fecha: Date;
    medioPago: any;
    notes: string | null;
    conceptoKey: string | null;
    conceptoLabelSnapshot: string | null;
    anio: number | null;
    amountTotal: number | null;
    amount4x1000: number | null;
  }>;
};

@Injectable()
export class TramitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private maxPdfPages(): number {
    const raw = this.config.get<string>('MAX_PDF_PAGES') ?? '15';
    const n = Number(raw);
    return Number.isFinite(n) ? n : 15;
  }

  private maxUploadBytes(): number {
    const raw = this.config.get<string>('MAX_UPLOAD_MB') ?? '20';
    const mb = Number(raw);
    return (Number.isFinite(mb) ? mb : 20) * 1024 * 1024;
  }

  private cuentaCobroTemplatePath(): string {
    const configured = this.config.get<string>('CUENTA_COBRO_TEMPLATE_PATH')?.trim();
    return path.resolve(process.cwd(), configured && configured.length > 0 ? configured : 'templates/CUENTA.pdf');
  }

  private displayId(year: number, concesionarioCode: string, consecutivo: number) {
    return `${year}-${concesionarioCode}-${pad4(consecutivo)}`;
  }

  private cuentaCobroDisplayId(year: number, concesionarioCode: string, consecutivo: number) {
    return `${String(consecutivo).padStart(3, '0')} -${concesionarioCode}-${year}`;
  }

  private formatCuentaCobroDate(d: Date) {
    const months = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  private formatCuentaCobroMoney(value: number) {
    const n = Number.isFinite(value) ? value : 0;
    return Math.round(n).toLocaleString('es-CO');
  }

  private normalizeCuentaCobroText(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const s = String(value).trim();
    return s.length > 0 ? s : null;
  }

  private resolveCuentaCobroServiceNameFromSnapshot(t: CuentaCobroTramiteRecord) {
    const serviceIdRaw = t.cuentaCobroServiceId?.trim() || '';
    const enumValues = new Set(Object.values(ServicioTipo) as string[]);
    if (serviceIdRaw && enumValues.has(serviceIdRaw)) {
      return resolveCuentaCobroServiceName(serviceIdRaw as ServicioTipo, t.serviceData ?? undefined);
    }
    return resolveCuentaCobroServiceName(t.tipoServicio, t.serviceData ?? undefined);
  }

  private parseCuentaCobroFecha(value?: string): Date {
    if (!value || value.trim().length === 0) return new Date();
    const d = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Fecha de pago inv�lida.', { fecha: value }, 400);
    }
    return d;
  }

  private getCuentaCobroExcludedConceptKeysByLegacyPayments(
    payments: Array<{ tipo: any; valor: number; conceptoKey: string | null }>,
  ): Set<string> {
    const excluded = new Set<string>();

    for (const p of payments) {
      if (findCuentaCobroConcept(p.conceptoKey)) continue;
      if (Number(p.valor ?? 0) <= 0) continue;

      if (p.tipo === 'TIMBRE') {
        excluded.add('IMPUESTO_TIMBRE');
        continue;
      }

      if (p.tipo === 'DERECHOS') {
        excluded.add('IMPUESTO_TRANSITO');
        excluded.add('MATRICULA');
      }
    }

    return excluded;
  }

  private async getCuentaCobroTramiteOrThrow(id: string): Promise<CuentaCobroTramiteRecord> {
    const t = (await this.prisma.tramite.findUnique({
      where: { id },
      include: {
        concesionario: { select: { name: true } },
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        payments: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            tipo: true,
            valor: true,
            fecha: true,
            medioPago: true,
            notes: true,
            conceptoKey: true,
            conceptoLabelSnapshot: true,
            anio: true,
            amountTotal: true,
            amount4x1000: true,
          },
        },
      },
    })) as CuentaCobroTramiteRecord | null;

    if (!t) throw new AppError('NOT_FOUND', 'Tr�mite no existe.', { id }, 404);
    return t;
  }

  private buildCuentaCobroState(t: CuentaCobroTramiteRecord) {
    const servicioNombreBd = this.resolveCuentaCobroServiceNameFromSnapshot(t);
    const servicioNombrePdf = (t.cuentaCobroConcepto?.trim() || servicioNombreBd).trim();
    const fechaCuentaCobro = t.cuentaCobroFecha ?? new Date();
    const encabezadoCliente = (t.cuentaCobroClienteNombre?.trim() || t.cliente.nombre || '').trim();
    const encabezadoDoc = (t.cuentaCobroClienteDoc?.trim() || t.cliente.doc || '').trim();
    const serviceDataPlaca =
      typeof t.serviceData === 'object' && t.serviceData && !Array.isArray(t.serviceData)
        ? String(((t.serviceData as Record<string, unknown>).placa ?? '')).trim()
        : '';
    const encabezadoPlaca = (t.cuentaCobroPlaca?.trim() || serviceDataPlaca || t.placa || '').trim();
    const encabezadoCiudad = (t.cuentaCobroCiudad?.trim() || t.ciudad.name || '').trim();
    const encabezadoConcesionario = (
      t.cuentaCobroConcesionario?.trim() ||
      t.concesionario?.name ||
      t.concesionarioCodeSnapshot ||
      ''
    ).trim();

    const managedPayments = t.payments.filter((p) => !!findCuentaCobroConcept(p.conceptoKey));
    const legacyPayments = t.payments.filter((p) => !findCuentaCobroConcept(p.conceptoKey));
    const excludedConceptKeysByLegacyPayments = this.getCuentaCobroExcludedConceptKeysByLegacyPayments(legacyPayments);

    const grouped = new Map<
      string,
      {
        amount_total: number;
        amount_4x1000: number;
        anio: number | null;
        last_fecha: Date | null;
        label_snapshot: string | null;
        notes_snapshot: string | null;
        ids: string[];
      }
    >();

    for (const p of managedPayments) {
      const def = findCuentaCobroConcept(p.conceptoKey);
      if (!def) continue;

      const amount4 = Math.max(0, Number(p.amount4x1000 ?? 0));
      const amountTotal = Math.max(
        0,
        Number(
          p.amountTotal ??
            // Compatibilidad si hay filas viejas con solo "valor"
            Math.max(0, (p.valor ?? 0) - amount4),
        ),
      );

      const acc =
        grouped.get(def.key) ?? {
          amount_total: 0,
          amount_4x1000: 0,
          anio: null,
          last_fecha: null,
          label_snapshot: null,
          notes_snapshot: null,
          ids: [],
        };
      acc.amount_total += amountTotal;
      acc.amount_4x1000 += amount4;
      acc.anio = p.anio ?? acc.anio ?? t.year;
      acc.last_fecha = p.fecha ?? acc.last_fecha;
      acc.label_snapshot = (p.conceptoLabelSnapshot?.trim() || acc.label_snapshot) ?? null;
      acc.notes_snapshot = (p.notes?.trim() || acc.notes_snapshot) ?? null;
      acc.ids.push(p.id);
      grouped.set(def.key, acc);
    }

    const conceptos = CUENTA_COBRO_CONCEPTS
      .filter((def) => !excludedConceptKeysByLegacyPayments.has(def.key))
      .map((def) => {
      const g = grouped.get(def.key);
      const amount_total = g?.amount_total ?? 0;
      const amount_4x1000 = g?.amount_4x1000 ?? 0;
      const anio = def.yearTop !== undefined ? (g?.anio ?? t.year) : null;
      const label =
        def.key === 'SERVICIO_PRINCIPAL'
          ? servicioNombrePdf
          : g?.label_snapshot?.trim() || def.label;
      return {
        key: def.key,
        conceptoId: def.conceptoId,
        label,
        concept_name: label,
        has4x1000: def.has4x1000,
        label4x1000: def.label4x1000,
        anio,
        year: anio,
        amount_total,
        amount_4x1000,
        observacion: g?.notes_snapshot ?? '',
        fecha: g?.last_fecha ? g.last_fecha.toISOString().slice(0, 10) : null,
        total: amount_total + amount_4x1000,
      };
    });

    const total_a_reembolsar = conceptos.reduce((acc, c) => acc + c.total, 0);
    const servicio_por_tramite_valor = Number((t as any).cuentaCobroValor ?? 0);
    const honorarios = Number((t as any).honorariosValor ?? 0);
    const total_cuenta_de_cobro = servicio_por_tramite_valor + honorarios;
    const menos_abono = Math.max(0, Number((t as any).cuentaCobroAbono ?? 0));
    const mas_total_cuenta_de_cobro = total_cuenta_de_cobro;
    const total_a_cancelar = total_a_reembolsar + mas_total_cuenta_de_cobro;
    const saldo_pdte_por_cancelar = total_a_cancelar - menos_abono;

    return {
      tramite: t,
      encabezado: {
        fecha: fechaCuentaCobro.toISOString().slice(0, 10),
        fecha_date: fechaCuentaCobro,
        cliente: encabezadoCliente,
        nit_o_cc: encabezadoDoc,
        placas: encabezadoPlaca,
        ciudad: encabezadoCiudad,
        concesionario: encabezadoConcesionario,
      },
      servicio: {
        id: t.cuentaCobroServiceId?.trim() || t.tipoServicio,
        nombre: servicioNombreBd,
        nombre_pdf: servicioNombrePdf,
        valor: servicio_por_tramite_valor,
      },
      conceptos,
      honorarios,
      legacy_payments_detected: {
        count: legacyPayments.length,
        total: legacyPayments.reduce((acc, p) => acc + p.valor, 0),
      },
      totales: {
        total_a_reembolsar,
        mas_total_cuenta_de_cobro,
        total_cuenta_de_cobro,
        total_a_cancelar,
        menos_abono,
        saldo_pdte_por_cancelar,
      },
    };
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

  private normalizeDocKey(docKey?: string) {
    const normalized = docKey?.trim().toUpperCase();
    if (!normalized) return undefined;
    return normalized;
  }

  private isFlexibleDocKey(docKey?: string) {
    return !!docKey && FLEXIBLE_DOC_KEY_SET.has(docKey);
  }

  private async findPreferredFlexibleDocType() {
    for (const key of FLEXIBLE_DOC_TYPE_PREFERENCE) {
      const docType = await this.prisma.documentType.findUnique({ where: { key } });
      if (docType) return docType;
    }
    return null;
  }

  private async ensureFlexibleChecklistItem(tramiteId: string) {
    const existingFlexibleItem = await this.prisma.tramiteDocument.findFirst({
      where: {
        tramiteId,
        docKey: { in: [...FLEXIBLE_DOC_KEYS] },
      },
      select: { id: true },
    });
    if (existingFlexibleItem) return;

    const preferredType = await this.findPreferredFlexibleDocType();
    const docKey = preferredType && this.isFlexibleDocKey(preferredType.key) ? preferredType.key : 'OTRO';

    await this.prisma.tramiteDocument.upsert({
      where: { tramiteId_docKey: { tramiteId, docKey } },
      update: {},
      create: {
        tramiteId,
        documentTypeId: preferredType?.id ?? null,
        docKey,
        nameSnapshot: preferredType?.name ?? FALLBACK_FLEXIBLE_NAME,
        required: false,
        status: 'PENDIENTE',
        receivedAt: null,
      },
    });
  }

  private async ensureChecklistItemForDocKey(
    tx: Prisma.TransactionClient,
    tramiteId: string,
    docKey: string,
    docType: { id: string; name: string; required: boolean },
  ) {
    const isFlexible = this.isFlexibleDocKey(docKey);

    await tx.tramiteDocument.upsert({
      where: { tramiteId_docKey: { tramiteId, docKey } },
      update: {},
      create: {
        tramiteId,
        documentTypeId: docType.id,
        docKey,
        nameSnapshot: isFlexible ? FALLBACK_FLEXIBLE_NAME : docType.name,
        required: isFlexible ? false : docType.required,
        status: 'PENDIENTE',
        receivedAt: null,
      },
    });
  }

  private isPdfMimeType(mimetype: string) {
    return mimetype === 'application/pdf';
  }

  private isSupportedUploadMimeType(mimetype: string) {
    return SUPPORTED_UPLOAD_MIME_TYPES.has(mimetype);
  }

  private extensionForMimeType(mimetype: string) {
    return MIME_EXTENSION_MAP[mimetype] ?? 'bin';
  }

  private resolveFilenameOriginal(
    dto: UploadTramiteFileDto,
    file: Express.Multer.File,
    requestedDocKey?: string,
    resolvedDocKey?: string,
  ) {
    const candidates = [dto.filenameOriginal, dto.customName, dto.nombrePersonalizado];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const clean = candidate.trim();
      if (clean.length > 0) return clean;
    }
    if (requestedDocKey && resolvedDocKey && requestedDocKey !== resolvedDocKey) {
      return requestedDocKey;
    }
    return file.originalname;
  }

  private async resolveUploadPageCount(file: Express.Multer.File, fileBuffer: Buffer) {
    if (this.isPdfMimeType(file.mimetype)) {
      return this.validatePdfOrThrow(fileBuffer);
    }
    return 1;
  }

  private async resolveDocType(docKey?: string) {
    const normalizedDocKey = this.normalizeDocKey(docKey);
    if (normalizedDocKey) {
      const requestedType = await this.prisma.documentType.findUnique({ where: { key: normalizedDocKey } });
      if (requestedType) {
        return { requestedDocKey: normalizedDocKey, docKey: normalizedDocKey, docType: requestedType };
      }

      if (this.isFlexibleDocKey(normalizedDocKey)) {
        const preferredFlexibleType = await this.findPreferredFlexibleDocType();
        if (!preferredFlexibleType) {
          throw new AppError(
            'MISSING_DOCUMENT_TYPE',
            'No existe un tipo de documento flexible (OTRO/DOC_FISICO) en catalogos.',
            { requestedDocKey: normalizedDocKey },
            500,
          );
        }
        return { requestedDocKey: normalizedDocKey, docKey: normalizedDocKey, docType: preferredFlexibleType };
      }
    }

    const fallbackType = await this.findPreferredFlexibleDocType();
    if (!fallbackType) {
      throw new AppError(
        'MISSING_DOCUMENT_TYPE',
        'No existe un tipo de documento flexible (OTRO/DOC_FISICO) en catalogos.',
        { requestedDocKey: normalizedDocKey ?? null },
        500,
      );
    }
    return { requestedDocKey: normalizedDocKey, docKey: 'OTRO', docType: fallbackType };
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
      throw new AppError('VALIDATION_ERROR', 'Archivo obligatorio.', { field }, 400);
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
        const clienteContactData = {
          ...(dto.clienteEmail !== undefined ? { email: dto.clienteEmail } : {}),
          ...(dto.clienteTelefono !== undefined ? { telefono: dto.clienteTelefono } : {}),
          ...(dto.clienteDireccion !== undefined ? { direccion: dto.clienteDireccion } : {}),
        };

        const clienteDoc = trimOptionalText(dto.clienteDoc);

        // cliente: documento primero (normalizado), nombre solo si no hay documento
        let cliente: ClienteMatchRow | null = null;
        if (clienteDoc) {
          cliente = await tx.cliente.findFirst({ where: { doc: clienteDoc } });

          if (!cliente) {
            const docKey = normalizeClienteDocKey(clienteDoc);
            if (docKey) {
              const rows = await tx.$queryRaw<ClienteMatchRow[]>(Prisma.sql`
                SELECT id, doc, nombre, email, telefono, direccion
                FROM "Cliente"
                WHERE regexp_replace(upper(doc), '[^A-Z0-9]', '', 'g') = ${docKey}
                ORDER BY id ASC
                LIMIT 1
              `);
              cliente = rows[0] ?? null;
            }
          }
        } else {
          const nameKey = normalizeClienteNameKey(dto.clienteNombre);
          if (nameKey) {
            const rows = await tx.$queryRaw<ClienteMatchRow[]>(Prisma.sql`
              SELECT id, doc, nombre, email, telefono, direccion
              FROM "Cliente"
              WHERE regexp_replace(
                translate(upper(nombre), ${CLIENTE_MATCH_SPANISH_UPPER_ACCENTS}, ${CLIENTE_MATCH_ASCII_UPPER_EQUIVALENTS}),
                '[^A-Z0-9]',
                '',
                'g'
              ) = ${nameKey}
              ORDER BY CASE WHEN btrim(doc) = '' THEN 1 ELSE 0 END, id ASC
              LIMIT 2
            `);

            if (rows.length > 1) {
              throw new AppError(
                'CLIENTE_AMBIGUOUS_MATCH',
                'Hay varios clientes con ese nombre. Ingresa cedula/NIT para identificar correctamente.',
                { nombre: dto.clienteNombre },
                409,
              );
            }

            cliente = rows[0] ?? null;
          }
        }

        if (!cliente) {
          cliente = await tx.cliente.create({
            data: {
              doc: clienteDoc ?? '',
              nombre: dto.clienteNombre,
              ...clienteContactData,
            },
          });
        } else {
          const clienteUpdateData = {
            ...(cliente.nombre !== dto.clienteNombre ? { nombre: dto.clienteNombre } : {}),
            ...(clienteDoc && cliente.doc !== clienteDoc ? { doc: clienteDoc } : {}),
            ...clienteContactData,
          };

          // opcional: actualiza nombre/contacto si llegaron cambios
          if (Object.keys(clienteUpdateData).length > 0) {
            cliente = await tx.cliente.update({
              where: { id: cliente.id },
              data: clienteUpdateData,
            });
          }
        }

        if (!cliente?.id) {
          throw new AppError(
            'CLIENTE_PERSISTENCE_ERROR',
            'No se pudo guardar/obtener el cliente antes de crear el tramite.',
            { clienteDoc: clienteDoc ?? null, clienteNombre: dto.clienteNombre },
            500,
          );
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

    const clienteDocQuery = trimOptionalText(query.clienteDoc ?? query.cliente_doc);
    if (clienteDocQuery) {
      const clienteDocKey = normalizeClienteDocKey(clienteDocQuery);
      if (clienteDocKey) {
        const clienteMatches = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM "Cliente"
          WHERE regexp_replace(upper(doc), '[^A-Z0-9]', '', 'g') = ${clienteDocKey}
        `);
        where.clienteId = { in: clienteMatches.map((row) => row.id) };
      } else {
        where.clienteId = { in: [] };
      }
    }
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
    const cuenta_cobro_valor = t.cuentaCobroValor == null ? null : Number((t as any).cuentaCobroValor);
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
      cuenta_cobro_concepto: t.cuentaCobroConcepto ?? null,
      cuenta_cobro_valor,
      total_final,
    };
  }

  async cuentaCobroData(id: string) {
    const t = await this.getCuentaCobroTramiteOrThrow(id);
    const state = this.buildCuentaCobroState(t);
    const pagos = state.conceptos.map((c) => ({
      conceptoId: c.conceptoId,
      concepto: c.label,
      anio: c.anio == null ? '' : String(c.anio),
      valor_total: c.amount_total,
      valor_4x1000: c.amount_4x1000,
      observacion: c.observacion ?? '',
    }));
    const totales = {
      totalAReembolsar: state.totales.total_a_reembolsar,
      masTotalCuentaDeCobro: state.totales.mas_total_cuenta_de_cobro,
      totalACancelar: state.totales.total_a_cancelar,
      menosAbono: state.totales.menos_abono,
      saldoPdtePorCancelar: state.totales.saldo_pdte_por_cancelar,
    };
    return {
      ...state,
      baseData: {
        serviceId: String(state.servicio.id),
        servicio: state.servicio.nombre,
        fecha: state.encabezado.fecha,
        cliente: state.encabezado.cliente,
        clienteDoc: state.encabezado.nit_o_cc,
        placas: state.encabezado.placas,
        ciudad: state.encabezado.ciudad,
        concesionario: state.encabezado.concesionario,
      },
      honorarios: state.honorarios,
      abono: state.totales.menos_abono,
      pagos,
      totales,
      tramite_id: t.id,
      display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
      base: {
        service_id: state.servicio.id,
        service_name: state.servicio.nombre,
        service_name_pdf: state.servicio.nombre_pdf,
        fecha: state.encabezado.fecha,
        cliente: state.encabezado.cliente,
        documento: state.encabezado.nit_o_cc,
        placa: state.encabezado.placas,
        ciudad: state.encabezado.ciudad,
        concesionario: state.encabezado.concesionario,
      },
    };
  }

  async cuentaCobroResumen(id: string) {
    const t = await this.getCuentaCobroTramiteOrThrow(id);
    const state = this.buildCuentaCobroState(t);
    const totales = {
      totalAReembolsar: state.totales.total_a_reembolsar,
      masTotalCuentaDeCobro: state.totales.mas_total_cuenta_de_cobro,
      totalACancelar: state.totales.total_a_cancelar,
      menosAbono: state.totales.menos_abono,
      saldoPdtePorCancelar: state.totales.saldo_pdte_por_cancelar,
    };
    return {
      baseData: {
        serviceId: String(state.servicio.id),
        servicio: state.servicio.nombre,
        fecha: state.encabezado.fecha,
        cliente: state.encabezado.cliente,
        clienteDoc: state.encabezado.nit_o_cc,
        placas: state.encabezado.placas,
        ciudad: state.encabezado.ciudad,
        concesionario: state.encabezado.concesionario,
      },
      honorarios: state.honorarios,
      abono: state.totales.menos_abono,
      pagos: state.conceptos.map((c) => ({
        conceptoId: c.conceptoId,
        concepto: c.label,
        anio: c.anio == null ? '' : String(c.anio),
        valor_total: c.amount_total,
        valor_4x1000: c.amount_4x1000,
        observacion: c.observacion ?? '',
      })),
      totales,
      tramite_id: t.id,
      display_id: this.displayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo),
      servicio: state.servicio,
      totales_detalle: state.totales,
      legacy_payments_detected: state.legacy_payments_detected,
    };
  }

  async setCuentaCobroBase(id: string, dto: SetCuentaCobroBaseDto, _userId: string | undefined) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Tr�mite no existe.', { id }, 404);
    this.assertNotCanceled(t);
    this.assertNotFinalized(t);

    const serviceIdCandidate = this.normalizeCuentaCobroText(dto.service_id ?? dto.serviceId);
    const servicioNombre = this.normalizeCuentaCobroText(dto.servicio);
    const clienteNombre = this.normalizeCuentaCobroText(dto.cliente);
    const clienteDoc = this.normalizeCuentaCobroText(
      dto.clienteDoc ?? dto.cliente_doc ?? dto.documento ?? dto.nit_o_cc,
    );
    const placaRaw = this.normalizeCuentaCobroText(dto.placa ?? dto.placas);
    const ciudad = this.normalizeCuentaCobroText(dto.ciudad);
    const concesionario = this.normalizeCuentaCobroText(dto.concesionario);
    const fecha =
      dto.fecha === undefined ? ((t as any).cuentaCobroFecha as Date | null) ?? new Date() : this.parseCuentaCobroFecha(dto.fecha);

    const data: Prisma.TramiteUpdateInput = {
      cuentaCobroFecha: fecha,
      ...(serviceIdCandidate !== undefined ? { cuentaCobroServiceId: serviceIdCandidate } : {}),
      ...(servicioNombre !== undefined ? { cuentaCobroConcepto: servicioNombre } : {}),
      ...(clienteNombre !== undefined ? { cuentaCobroClienteNombre: clienteNombre } : {}),
      ...(clienteDoc !== undefined ? { cuentaCobroClienteDoc: clienteDoc } : {}),
      ...(placaRaw !== undefined ? { cuentaCobroPlaca: placaRaw ? this.normalizePlaca(placaRaw) : null } : {}),
      ...(ciudad !== undefined ? { cuentaCobroCiudad: ciudad } : {}),
      ...(concesionario !== undefined ? { cuentaCobroConcesionario: concesionario } : {}),
    };

    await this.prisma.tramite.update({
      where: { id },
      data,
    });

    return this.cuentaCobroData(id);
  }

  async saveCuentaCobroPagos(id: string, dto: SaveCuentaCobroPagosDto, userId: string | undefined) {
    if (!userId) throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);

    const t = await this.prisma.tramite.findUnique({
      where: { id },
      include: {
        concesionario: { select: { name: true } },
        ciudad: { select: { name: true } },
        cliente: { select: { nombre: true, doc: true } },
        payments: {
          select: {
            id: true,
            tipo: true,
            valor: true,
            conceptoKey: true,
          },
        },
      },
    });
    if (!t) throw new AppError('NOT_FOUND', 'Tramite no existe.', { id }, 404);
    this.assertNotCanceled(t);
    this.assertNotFinalized(t);

    const payloadItems = dto.pagos ?? dto.conceptos ?? dto.items ?? [];
    const excludedConceptKeysByLegacyPayments = this.getCuentaCobroExcludedConceptKeysByLegacyPayments(
      t.payments.map((p) => ({
        tipo: p.tipo,
        valor: p.valor,
        conceptoKey: p.conceptoKey,
      })),
    );

    if ((payloadItems?.length ?? 0) > CUENTA_COBRO_CONCEPTS.length) {
      throw new AppError(
        'VALIDATION_ERROR',
        'La plantilla solo soporta un numero limitado de conceptos.',
        { maxConcepts: CUENTA_COBRO_CONCEPTS.length, received: payloadItems?.length ?? 0 },
        400,
      );
    }

    const assignedKeys = new Set<string>();
    let nextSlotIndex = 0;
    const normalizedItems = payloadItems.map((item) => {
      const explicitId = (item as any).conceptoId ? String((item as any).conceptoId).trim().toLowerCase() : undefined;
      const explicitKey = item.concepto_key ? String(item.concepto_key).trim().toUpperCase() : undefined;
      let def = explicitId ? findCuentaCobroConceptById(explicitId) : undefined;
      if (!def && explicitKey) def = findCuentaCobroConcept(explicitKey);
      if (explicitKey && !def) {
        throw new AppError('VALIDATION_ERROR', 'Concepto de cuenta de cobro invalido.', { concepto_key: explicitKey }, 400);
      }
      if (explicitId && !def) {
        throw new AppError('VALIDATION_ERROR', 'Concepto de cuenta de cobro invalido.', { conceptoId: explicitId }, 400);
      }

      if (!def) {
        while (nextSlotIndex < CUENTA_COBRO_CONCEPTS.length && assignedKeys.has(CUENTA_COBRO_CONCEPTS[nextSlotIndex].key)) {
          nextSlotIndex++;
        }
        def = CUENTA_COBRO_CONCEPTS[nextSlotIndex];
        if (!def) {
          throw new AppError(
            'VALIDATION_ERROR',
            'No hay mas filas disponibles en la plantilla para conceptos.',
            { maxConcepts: CUENTA_COBRO_CONCEPTS.length },
            400,
          );
        }
      }

      if (assignedKeys.has(def.key)) {
        throw new AppError('VALIDATION_ERROR', 'Concepto duplicado en pagos de cuenta de cobro.', { concepto_key: def.key }, 400);
      }
      assignedKeys.add(def.key);

      const amountTotalRaw = (item as any).valor_total ?? item.amount_total ?? (item as any).total;
      const amount4x1000Raw = (item as any).valor_4x1000 ?? item.amount_4x1000 ?? (item as any).valor4x1000;
      const amountTotalParsed = this.parseMoney(amountTotalRaw);
      const amount4x1000Parsed = this.parseMoney(amount4x1000Raw);
      const amountTotal = Math.max(0, Number((amountTotalParsed ?? 0)));
      const amount4x1000 = Math.max(0, Number((amount4x1000Parsed ?? 0)));
      if (!Number.isFinite(amountTotal) || !Number.isFinite(amount4x1000)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Montos invalidos en cuenta de cobro.',
          { conceptoId: explicitId ?? def.key, valor_total: amountTotalRaw, valor_4x1000: amount4x1000Raw },
          400,
        );
      }
      if (!def.has4x1000 && amount4x1000 > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'El concepto no permite 4x1000.',
          { concepto_key: def.key, amount_4x1000: amount4x1000 },
          400,
        );
      }

      const conceptNameCandidate = (item as any).concepto ?? (item as any).concept_name ?? (item as any).nombre;
      const conceptNameRaw = typeof conceptNameCandidate === 'string' ? conceptNameCandidate.trim() : '';
      const observacionCandidate = (item as any).observacion ?? item.notes;
      const observacionRaw = typeof observacionCandidate === 'string' ? observacionCandidate.trim() : '';
      return {
        item,
        def,
        amountTotal,
        amount4x1000,
        conceptNameRaw,
        observacionRaw,
      };
    });

    const normalizedItemsToPersist = normalizedItems.filter(
      (row) => !excludedConceptKeysByLegacyPayments.has(row.def.key),
    );
    const normalizedByKey = new Map(normalizedItemsToPersist.map((row) => [row.def.key, row] as const));

    const servicioNombre = resolveCuentaCobroServiceName(t.tipoServicio, (t as any).serviceData ?? undefined);
    const managedConceptKeys = CUENTA_COBRO_CONCEPTS.map((c) => c.key);

    await this.prisma.$transaction(async (tx) => {
      const existingManagedRows = await tx.payment.findMany({
        where: {
          tramiteId: id,
          conceptoKey: { in: managedConceptKeys },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          conceptoKey: true,
          fecha: true,
          medioPago: true,
        },
      });

      const existingByKey = new Map<string, typeof existingManagedRows>();
      for (const row of existingManagedRows) {
        const key = String(row.conceptoKey ?? '').trim().toUpperCase();
        if (!key) continue;
        const acc = existingByKey.get(key) ?? [];
        acc.push(row);
        existingByKey.set(key, acc);
      }

      for (const def of CUENTA_COBRO_CONCEPTS) {
        const existingRows = existingByKey.get(def.key) ?? [];
        const incoming = normalizedByKey.get(def.key);

        if (!incoming) {
          if (existingRows.length > 0) {
            await tx.payment.deleteMany({
              where: { id: { in: existingRows.map((r) => r.id) } },
            });
          }
          continue;
        }

        const { item, amountTotal, amount4x1000, conceptNameRaw, observacionRaw } = incoming;
        const rowTotal = amountTotal + amount4x1000;
        if (rowTotal <= 0) {
          if (existingRows.length > 0) {
            await tx.payment.deleteMany({
              where: { id: { in: existingRows.map((r) => r.id) } },
            });
          }
          continue;
        }

        const defaultLabel = def.key === 'SERVICIO_PRINCIPAL' ? servicioNombre : def.label;
        const label = conceptNameRaw || defaultLabel;
        const inputYear = (item as any).year ?? item.anio;
        let anio: number | null = null;
        if (def.yearTop !== undefined) {
          const yearRaw = inputYear ?? t.year ?? new Date().getFullYear();
          const yearNum = Number(yearRaw);
          if (!Number.isFinite(yearNum) || yearNum < 2000) {
            throw new AppError('VALIDATION_ERROR', 'Anio invalido para cuenta de cobro.', { conceptoId: def.conceptoId, anio: yearRaw }, 400);
          }
          anio = Math.trunc(yearNum);
        }

        const firstExisting = existingRows[0];
        const fecha = item.fecha ? this.parseCuentaCobroFecha(item.fecha) : (firstExisting?.fecha ?? new Date());
        const medioPago = (((item.medio_pago ?? firstExisting?.medioPago ?? 'OTRO') as MedioPago) ?? 'OTRO') as MedioPago;

        const data = {
          tipo: def.paymentTipo,
          valor: rowTotal,
          conceptoKey: def.key,
          conceptoLabelSnapshot: label,
          anio,
          amountTotal,
          amount4x1000,
          fecha,
          medioPago,
          notes: observacionRaw || null,
        };

        if (firstExisting) {
          await tx.payment.update({
            where: { id: firstExisting.id },
            data,
          });

          if (existingRows.length > 1) {
            await tx.payment.deleteMany({
              where: { id: { in: existingRows.slice(1).map((r) => r.id) } },
            });
          }
          continue;
        }

        await tx.payment.create({
          data: {
            tramiteId: id,
            createdById: userId,
            ...data,
          },
        });
      }
    });

    return this.cuentaCobroData(id);
  }

  async setCuentaCobroHonorarios(id: string, honorarios: number | undefined, _userId: string | undefined) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Tr�mite no existe.', { id }, 404);
    this.assertNotCanceled(t);
    this.assertNotFinalized(t);

    const honorariosNormalized = Math.max(0, Number(honorarios ?? 0) || 0);

    await this.prisma.tramite.update({
      where: { id },
      data: { honorariosValor: honorariosNormalized as any },
    });

    return this.cuentaCobroResumen(id);
  }

  async setCuentaCobroAbono(id: string, abono: number | undefined, _userId: string | undefined) {
    const t = await this.prisma.tramite.findUnique({ where: { id } });
    if (!t) throw new AppError('NOT_FOUND', 'Tr�mite no existe.', { id }, 404);
    this.assertNotCanceled(t);
    this.assertNotFinalized(t);

    const abonoNormalized = Math.max(0, Number(abono ?? 0) || 0);

    await this.prisma.tramite.update({
      where: { id },
      data: { cuentaCobroAbono: abonoNormalized as any },
    });

    return this.cuentaCobroResumen(id);
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

    const cuentaCobroValorParsed = this.parseMoney((dto as any).cuentaCobroValor);
    if (cuentaCobroValorParsed !== null) {
      if (!Number.isFinite(cuentaCobroValorParsed)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'cuentaCobroValor inválido.',
          { cuentaCobroValor: (dto as any).cuentaCobroValor },
          400,
        );
      }
      if (cuentaCobroValorParsed < 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'cuentaCobroValor no puede ser negativo.',
          { cuentaCobroValor: cuentaCobroValorParsed },
          400,
        );
      }
    }

    const cuentaCobroConceptoNormalized =
      dto.cuentaCobroConcepto === undefined
        ? undefined
        : dto.cuentaCobroConcepto == null
          ? null
          : (dto.cuentaCobroConcepto.trim() || null);

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
            ...(cuentaCobroConceptoNormalized !== undefined
              ? { cuentaCobroConcepto: cuentaCobroConceptoNormalized }
              : {}),
            ...(cuentaCobroValorParsed !== null ? { cuentaCobroValor: cuentaCobroValorParsed as any } : {}),
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
        ...(cuentaCobroConceptoNormalized !== undefined
          ? { cuentaCobroConcepto: cuentaCobroConceptoNormalized }
          : {}),
        ...(cuentaCobroValorParsed !== null ? { cuentaCobroValor: cuentaCobroValorParsed as any } : {}),
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

  async remove(id: string, userId: string) {
    if (!userId) throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);

    const t = await this.prisma.tramite.findUnique({
      where: { id },
      select: {
        id: true,
        tipoServicio: true,
        files: { select: { storagePath: true } },
        shipmentLinks: { select: { shipmentId: true } },
      },
    });
    if (!t) throw new AppError('NOT_FOUND', 'Tramite no existe.', { id }, 404);
    this.assertIsMatricula(t);

    const filePaths = t.files.map((f) => f.storagePath).filter((p): p is string => !!p);
    const shipmentIds = [...new Set(t.shipmentLinks.map((l) => l.shipmentId))];

    const txResult = await this.prisma.$transaction(async (tx) => {
      const reservas = await tx.consecutivoReserva.updateMany({
        where: { tramiteId: id },
        data: { status: 'LIBERADO', releasedAt: new Date(), tramiteId: null },
      });

      await tx.tramite.delete({ where: { id } });

      const orphanShipments = shipmentIds.length
        ? await tx.shipment.deleteMany({
            where: {
              id: { in: shipmentIds },
              links: { none: {} },
            },
          })
        : { count: 0 };

      return {
        reservasLiberadas: reservas.count,
        enviosHuerfanosEliminados: orphanShipments.count,
      };
    });

    await Promise.allSettled(filePaths.map((storagePath) => this.storage.deleteFileIfExists(storagePath)));

    return {
      ok: true,
      id,
      reservas_liberadas: txResult.reservasLiberadas,
      archivos_eliminados: filePaths.length,
      envios_huerfanos_eliminados: txResult.enviosHuerfanosEliminados,
    };
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
    await this.ensureFlexibleChecklistItem(id);

    const rows = await this.prisma.tramiteDocument.findMany({
      where: { tramiteId: id },
      orderBy: { nameSnapshot: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      docKey: r.docKey,
      name_snapshot: r.nameSnapshot,
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
      uploaded_by: f.uploadedById,
      page_count: f.pageCount,
      filename_original: f.filenameOriginal,
    }));
  }

  async uploadFile(tramiteId: string, dto: UploadTramiteFileDto, file: Express.Multer.File, userId: string) {
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Archivo obligatorio.', { field: 'file' }, 400);
    }
    if (!this.isSupportedUploadMimeType(file.mimetype)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Formato no soportado. Solo se permite PDF, JPG, PNG o WEBP.',
        { mimetype: file.mimetype },
        400,
      );
    }
    if (file.size > this.maxUploadBytes()) {
      throw new AppError('UPLOAD_TOO_LARGE', 'Archivo demasiado grande.', {}, 413);
    }

    const tramite = await this.prisma.tramite.findUnique({ where: { id: tramiteId } });
    if (!tramite) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: tramiteId }, 404);
    this.assertIsMatricula(tramite);

    this.assertNotCanceled(tramite);
    this.assertNotFinalized(tramite);

    const { requestedDocKey, docKey, docType } = await this.resolveDocType(dto.docKey);

    const fileBuffer = await this.getUploadBuffer(file, 'file');
    const pageCount = await this.resolveUploadPageCount(file, fileBuffer);

    const last = await this.prisma.tramiteFile.findFirst({
      where: { tramiteId, docKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    const extension = this.extensionForMimeType(file.mimetype);
    const filename = `${docKey}_v${version}.${extension}`;
    const storagePath = this.storage.buildRelativePath(
      tramite.year,
      tramite.concesionarioCodeSnapshot,
      tramite.consecutivo,
      filename,
    );
    const filenameOriginal = this.resolveFilenameOriginal(dto, file, requestedDocKey, docKey);

    try {
      await this.storage.writeFile(storagePath, fileBuffer);

      const created = await this.prisma.$transaction(async (tx) => {
        await this.ensureChecklistItemForDocKey(tx, tramiteId, docKey, docType);

        const f = await tx.tramiteFile.create({
          data: {
            tramiteId,
            docKey,
            documentTypeId: docType.id,
            filenameOriginal,
            storagePath,
            pageCount,
            version,
            uploadedById: userId,
          },
        });

        // marcar checklist como recibido si existe
        await tx.tramiteDocument.updateMany({
          where: { tramiteId, docKey },
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
    const t = await this.getCuentaCobroTramiteOrThrow(tramiteId);
    const state = this.buildCuentaCobroState(t);

    const templatePath = this.cuentaCobroTemplatePath();
    let templateBytes: Buffer;
    try {
      templateBytes = await readFile(templatePath);
    } catch {
      throw new AppError(
        'CUENTA_COBRO_TEMPLATE_NOT_FOUND',
        'No se encontr� la plantilla de cuenta de cobro.',
        { templatePath },
        500,
      );
    }

    const template = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
    if (template.getPageCount() < 1) {
      throw new AppError('CUENTA_COBRO_TEMPLATE_INVALID', 'La plantilla de cuenta de cobro no tiene p�ginas.', {}, 500);
    }

    const out = await PDFDocument.create();
    const [page] = await out.copyPages(template, [0]); // solo p�gina 1
    out.addPage(page);

    const pdfPage = out.getPage(0);
    const { height } = pdfPage.getSize();
    const fontRegular = await out.embedFont(StandardFonts.Helvetica);
    const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);
    const paperWhite = rgb(0.96, 0.96, 0.96);

    const topToY = (topY: number, fontSize: number) => height - topY - fontSize + 1;
    const fitText = (
      text: string,
      font: import('pdf-lib').PDFFont,
      preferredSize: number,
      maxWidth: number,
      minSize: number,
    ) => {
      let size = preferredSize;
      let value = text;
      let width = font.widthOfTextAtSize(value, size);

      while (size > minSize && width > maxWidth) {
        size -= 0.5;
        width = font.widthOfTextAtSize(value, size);
      }

      if (width > maxWidth) {
        let trimmed = value;
        while (trimmed.length > 0 && font.widthOfTextAtSize(`${trimmed}...`, size) > maxWidth) {
          trimmed = trimmed.slice(0, -1);
        }
        value = trimmed.length > 0 ? `${trimmed}...` : '';
        width = font.widthOfTextAtSize(value, size);
      }

      return { text: value, size, width };
    };

    const drawRightTop = (
      text: string,
      topY: number,
      rightX: number,
      opts: { font?: import('pdf-lib').PDFFont; size?: number; maxWidth?: number; minSize?: number } = {},
    ) => {
      if (!text) return;
      const font = opts.font ?? fontRegular;
      const size = opts.size ?? 10;
      const maxWidth = opts.maxWidth ?? 200;
      const minSize = opts.minSize ?? 7;
      const fitted = fitText(text, font, size, maxWidth, minSize);
      pdfPage.drawText(fitted.text, {
        x: rightX - fitted.width,
        y: topToY(topY, fitted.size),
        size: fitted.size,
        font,
        color: black,
      });
    };

    const drawCenterTop = (
      text: string,
      topY: number,
      cellX: number,
      cellWidth: number,
      opts: {
        font?: import('pdf-lib').PDFFont;
        size?: number;
        maxWidth?: number;
        minSize?: number;
        eraseBackground?: boolean;
        erasePadX?: number;
        erasePadTop?: number;
        erasePadBottom?: number;
      } = {},
    ) => {
      if (!text) return;
      const font = opts.font ?? fontRegular;
      const size = opts.size ?? 10;
      const maxWidth = opts.maxWidth ?? cellWidth;
      const minSize = opts.minSize ?? 7;
      const fitted = fitText(text, font, size, maxWidth, minSize);
      const x = cellX + Math.max(0, (cellWidth - fitted.width) / 2);
      const y = topToY(topY, fitted.size);
      if (opts.eraseBackground) {
        const padX = opts.erasePadX ?? 4;
        const padTop = opts.erasePadTop ?? 1.5;
        const padBottom = opts.erasePadBottom ?? 1.5;
        pdfPage.drawRectangle({
          x: x - padX,
          y: y - padBottom,
          width: fitted.width + padX * 2,
          height: fitted.size + padTop + padBottom,
          color: paperWhite,
          borderWidth: 0,
        });
      }
      pdfPage.drawText(fitted.text, {
        x,
        y,
        size: fitted.size,
        font,
        color: black,
      });
    };

    const eraseTopRect = (x: number, topY: number, width: number, rectHeight: number) => {
      pdfPage.drawRectangle({
        x,
        y: height - topY - rectHeight,
        width,
        height: rectHeight,
        color: white,
        borderWidth: 0,
      });
    };

    const drawMoneyRow = (topY: number, value: number, opts: { size?: number } = {}) => {
      drawRightTop(`$ ${this.formatCuentaCobroMoney(value)}`, topY, CUENTA_COBRO_PDF_COORDS.tableValueRightX, {
        font: fontBold,
        size: opts.size ?? 10.5,
        maxWidth: 140,
        minSize: 8,
      });
    };

    const drawYearRow = (topY: number, year: number | null, opts: { clearTemplateText?: boolean } = {}) => {
      if (!year) return;
      drawCenterTop(String(year), topY, CUENTA_COBRO_PDF_COORDS.tableYearCellX, CUENTA_COBRO_PDF_COORDS.tableYearCellWidth, {
        font: fontBold,
        size: 10,
        maxWidth: CUENTA_COBRO_PDF_COORDS.tableYearCellWidth - 6,
        minSize: 8,
        eraseBackground: opts.clearTemplateText,
        erasePadX: 5,
        erasePadTop: 1.5,
        erasePadBottom: 1.0,
      });
    };

    const cuentaId = this.cuentaCobroDisplayId(t.year, t.concesionarioCodeSnapshot, t.consecutivo);
    const fecha = this.formatCuentaCobroDate((((state as any).encabezado?.fecha_date as Date | undefined) ?? new Date()));
    const clienteNombre = (state.encabezado.cliente ?? '').trim().toUpperCase();
    const clienteDoc = (state.encabezado.nit_o_cc ?? '').trim();
    const placa = (state.encabezado.placas ?? '').trim().toUpperCase();
    const ciudad = (state.encabezado.ciudad ?? '').trim().toUpperCase();
    const concesionario = (state.encabezado.concesionario ?? '').trim().toUpperCase();

    const headerRightX = CUENTA_COBRO_PDF_COORDS.headerRightX;
    drawRightTop(cuentaId, 55.5, headerRightX, { font: fontBold, size: 11, maxWidth: 170, minSize: 8 });
    drawRightTop(fecha, 70.4, headerRightX, { font: fontBold, size: 10, maxWidth: 170, minSize: 8 });
    drawRightTop(clienteNombre, 86.8, headerRightX, { font: fontBold, size: 8.5, maxWidth: 170, minSize: 6.5 });
    drawRightTop(clienteDoc, 103.0, headerRightX, { font: fontBold, size: 8.5, maxWidth: 145, minSize: 7 });
    drawRightTop(placa, 117.3, headerRightX, { font: fontBold, size: 10, maxWidth: 120, minSize: 8 });
    drawRightTop(ciudad, 131.8, headerRightX, { font: fontBold, size: 10, maxWidth: 170, minSize: 7 });
    drawRightTop(concesionario, 146.4, headerRightX, { font: fontBold, size: 10, maxWidth: 135, minSize: 7 });

    // Top section values
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.topServiceValue, state.honorarios);
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.topTotalCuentaCobroValue, state.totales.saldo_pdte_por_cancelar);

    // Concept row "Traspaso" -> servicio real
    const servicioPrincipal = state.conceptos.find((c) => c.key === 'SERVICIO_PRINCIPAL');
    drawCenterTop(
      (state.servicio.nombre_pdf ?? servicioPrincipal?.label ?? state.servicio.nombre ?? 'SERVICIO').toUpperCase(),
      362.8,
      CUENTA_COBRO_PDF_COORDS.tableConceptCellX,
      CUENTA_COBRO_PDF_COORDS.tableConceptCellWidth,
      {
        font: fontBold,
        size: 10,
        maxWidth: CUENTA_COBRO_PDF_COORDS.tableConceptCellWidth - 12,
        minSize: 7,
      },
    );

    for (const c of state.conceptos) {
      const def = findCuentaCobroConcept(c.key);
      if (!def) continue;
      if (def.yearTop !== undefined && c.key !== 'IMPUESTO_TIMBRE') {
        drawYearRow(def.yearTop, c.anio);
      }
      if (def.valueTop !== undefined) drawMoneyRow(def.valueTop, c.amount_total);
      if (def.has4x1000 && def.value4xTop !== undefined) drawMoneyRow(def.value4xTop, c.amount_4x1000);
    }

    // Bloque de totales
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.totals.totalReembolsar, state.totales.total_a_reembolsar);
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.totals.masTotalCuentaCobro, state.totales.mas_total_cuenta_de_cobro);
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.totals.totalCancelar, state.totales.total_a_cancelar);
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.totals.menosAbono, state.totales.menos_abono);
    drawMoneyRow(CUENTA_COBRO_PDF_COORDS.totals.saldoPendiente, state.totales.saldo_pdte_por_cancelar);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cuenta-cobro-${t.year}-${t.concesionarioCodeSnapshot}-${String(t.consecutivo).padStart(4, '0')}.pdf"`,
    );

    const outputBytes = await out.save();
    res.end(Buffer.from(outputBytes));
  }
}










