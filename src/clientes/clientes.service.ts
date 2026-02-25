import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';

function normalizeNullableText(value: string | null | undefined) {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByDoc(docRaw: string) {
    const doc = String(docRaw ?? '').trim();
    if (!doc) {
      throw new AppError('VALIDATION_ERROR', 'Cedula/documento es requerido.', { doc: docRaw }, 400);
    }

    const cliente = await this.prisma.cliente.findFirst({
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

    if (!cliente) {
      return {
        exists: false,
        cliente: null,
      };
    }

    return {
      exists: true,
      cliente: {
        id: cliente.id,
        doc: cliente.doc,
        nombre: cliente.nombre,
        email: normalizeNullableText(cliente.email),
        telefono: normalizeNullableText(cliente.telefono),
        direccion: normalizeNullableText(cliente.direccion),
      },
    };
  }
}
