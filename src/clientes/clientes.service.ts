import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertClienteDto } from './dto/upsert-cliente.dto';

const SPANISH_UPPER_ACCENTS = 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const ASCII_UPPER_EQUIVALENTS = 'AAAAAEEEEIIIIOOOOOUUUUNC';

function normalizeNullableText(value: string | null | undefined) {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

function requiredDoc(docRaw: string | undefined) {
  const doc = String(docRaw ?? '').trim();
  if (!doc) {
    throw new AppError('VALIDATION_ERROR', 'Cedula/documento es requerido.', { doc: docRaw }, 400);
  }
  return doc;
}

function trimOptional(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function normalizeDocKey(value: string | undefined): string | null {
  const s = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}

function normalizeNameKey(value: string | undefined): string | null {
  const s = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length > 0 ? s : null;
}

type ClienteRow = {
  id: string;
  doc: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
};

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  private async findClientesByNormalizedName(nombreRaw: string) {
    const nombre = trimOptional(nombreRaw);
    if (!nombre) return [] as ClienteRow[];

    const nameKey = normalizeNameKey(nombre);
    if (!nameKey) return [] as ClienteRow[];

    return this.prisma.$queryRaw<ClienteRow[]>(Prisma.sql`
      SELECT id, doc, nombre, email, telefono, direccion
      FROM "Cliente"
      WHERE regexp_replace(
        translate(upper(nombre), ${SPANISH_UPPER_ACCENTS}, ${ASCII_UPPER_EQUIVALENTS}),
        '[^A-Z0-9]',
        '',
        'g'
      ) = ${nameKey}
      ORDER BY CASE WHEN btrim(doc) = '' THEN 1 ELSE 0 END, id ASC
      LIMIT 2
    `);
  }

  private async findClienteEntityByDoc(docRaw: string) {
    const doc = requiredDoc(docRaw);
    let cliente = await this.prisma.cliente.findFirst({
      where: { doc },
      select: {
        id: true,
        doc: true,
        nombre: true,
        email: true,
        telefono: true,
        direccion: true,
      },
    });

    // Fallback tolerant lookup: matches the same document with formatting differences
    // (e.g. "1.044.210.426" vs "1044210426").
    if (!cliente) {
      const docKey = normalizeDocKey(doc);
      if (docKey) {
        const rows = await this.prisma.$queryRaw<ClienteRow[]>(Prisma.sql`
          SELECT id, doc, nombre, email, telefono, direccion
          FROM "Cliente"
          WHERE regexp_replace(upper(doc), '[^A-Z0-9]', '', 'g') = ${docKey}
          ORDER BY id ASC
          LIMIT 1
        `);
        cliente = rows[0] ?? null;
      }
    }

    return { doc, cliente };
  }

  private toCanonicalCliente(cliente: {
    id: string;
    doc: string;
    nombre: string;
    email: string | null;
    telefono: string | null;
    direccion: string | null;
  }) {
    return {
      id: cliente.id,
      documento: cliente.doc,
      doc: cliente.doc,
      nombre: cliente.nombre,
      email: normalizeNullableText(cliente.email),
      telefono: normalizeNullableText(cliente.telefono),
      direccion: normalizeNullableText(cliente.direccion),
    };
  }

  async findByDoc(docRaw: string) {
    const { cliente } = await this.findClienteEntityByDoc(docRaw);

    if (!cliente) {
      return {
        exists: false,
        cliente: null,
      };
    }

    return {
      exists: true,
      cliente: this.toCanonicalCliente(cliente),
    };
  }

  async findByDocumento(docRaw: string) {
    const { doc, cliente } = await this.findClienteEntityByDoc(docRaw);
    if (!cliente) {
      throw new AppError('NOT_FOUND', 'Cliente no existe.', { documento: doc }, 404);
    }
    return this.toCanonicalCliente(cliente);
  }

  async search(query: { documento?: string; q?: string }) {
    const documento = trimOptional(query.documento);
    const q = trimOptional(query.q);

    if (documento) {
      const { cliente } = await this.findClienteEntityByDoc(documento);
      return {
        items: cliente ? [this.toCanonicalCliente(cliente)] : [],
        total: cliente ? 1 : 0,
      };
    }

    if (!q) {
      return { items: [], total: 0 };
    }

    const clientes = await this.prisma.cliente.findMany({
      where: {
        OR: [
          { doc: { contains: q, mode: 'insensitive' } },
          { nombre: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { telefono: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: [{ nombre: 'asc' }],
      select: {
        id: true,
        doc: true,
        nombre: true,
        email: true,
        telefono: true,
        direccion: true,
      },
    });

    return {
      items: clientes.map((cliente) => this.toCanonicalCliente(cliente)),
      total: clientes.length,
    };
  }

  async listForUsuariosTab(qRaw?: string) {
    const q = trimOptional(qRaw);
    const where: Prisma.ClienteWhereInput = {};

    if (q) {
      where.OR = [
        { doc: { contains: q, mode: 'insensitive' } },
        { nombre: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { telefono: { contains: q, mode: 'insensitive' } },
        { direccion: { contains: q, mode: 'insensitive' } },
      ];
    }

    const clientes = await this.prisma.cliente.findMany({
      where,
      orderBy: [{ nombre: 'asc' }, { doc: 'asc' }],
      select: {
        id: true,
        doc: true,
        nombre: true,
        email: true,
        telefono: true,
        direccion: true,
      },
    });

    return {
      items: clientes.map((cliente) => ({
        id: cliente.id,
        documento: cliente.doc,
        doc: cliente.doc,
        nombre: cliente.nombre,
        name: cliente.nombre,
        email: normalizeNullableText(cliente.email),
        telefono: normalizeNullableText(cliente.telefono),
        phone: normalizeNullableText(cliente.telefono),
        direccion: normalizeNullableText(cliente.direccion),
        address: normalizeNullableText(cliente.direccion),
        rol: 'CLIENTE',
        role: 'cliente',
        activo: true,
        is_active: true,
        status: 'active',
      })),
      total: clientes.length,
    };
  }

  async upsert(dto: UpsertClienteDto) {
    const documento =
      trimOptional(dto.documento) ??
      trimOptional(dto.doc) ??
      trimOptional(dto.clienteDoc) ??
      trimOptional(dto.identificacion);

    const nombreInput =
      trimOptional(dto.nombre) ??
      trimOptional(dto.name) ??
      trimOptional(dto.clienteNombre) ??
      trimOptional(dto.razon_social);

    const telefono =
      trimOptional(dto.telefono) ?? trimOptional(dto.phone) ?? trimOptional(dto.celular);
    const direccion = trimOptional(dto.direccion) ?? trimOptional(dto.address);
    const email = trimOptional(dto.email) ?? trimOptional(dto.correo);

    let existing: ClienteRow | null = null;
    if (documento) {
      ({ cliente: existing } = await this.findClienteEntityByDoc(documento));
    }

    const nombre = nombreInput ?? existing?.nombre;
    if (!nombre) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Nombre del cliente es requerido.',
        { documento: documento ?? null },
        400,
      );
    }

    if (!existing && !documento) {
      const byName = await this.findClientesByNormalizedName(nombre);
      if (byName.length > 1) {
        throw new AppError(
          'CLIENTE_AMBIGUOUS_MATCH',
          'Hay varios clientes con ese nombre. Ingresa cédula/NIT para identificar correctamente.',
          { nombre },
          409,
        );
      }
      existing = byName[0] ?? null;
    }

    const doc = documento ?? existing?.doc ?? '';

    const saved = existing
      ? await this.prisma.cliente.update({
          where: { id: existing.id },
          data: {
            nombre,
            ...(documento && existing.doc !== documento ? { doc: documento } : {}),
            email: email ?? existing.email,
            telefono: telefono ?? existing.telefono,
            direccion: direccion ?? existing.direccion,
          },
          select: {
            id: true,
            doc: true,
            nombre: true,
            email: true,
            telefono: true,
            direccion: true,
          },
        })
      : await this.prisma.cliente.create({
          data: {
            doc,
            nombre,
            email: email ?? null,
            telefono: telefono ?? null,
            direccion: direccion ?? null,
          },
          select: {
            id: true,
            doc: true,
            nombre: true,
            email: true,
            telefono: true,
            direccion: true,
          },
        });

    return this.toCanonicalCliente(saved);
  }
}
