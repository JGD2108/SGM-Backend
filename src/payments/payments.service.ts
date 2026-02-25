import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(p: {
    id: string;
    tipo: string;
    valor: number;
    fecha: Date;
    medioPago: string;
    notes: string | null;
  }) {
    return {
      id: p.id,
      tipo: p.tipo,
      valor: p.valor,
      fecha: p.fecha.toISOString().slice(0, 10),
      medio_pago: p.medioPago,
      notes: p.notes ?? '',
    };
  }

  private assertNotFinalizedOrCanceled(tramite: { estadoActual: string }) {
    if (tramite.estadoActual === 'CANCELADO') {
      throw new AppError('CANCELED_LOCK', 'El trámite está cancelado. No se puede modificar.', {}, 409);
    }
    if (tramite.estadoActual === 'FINALIZADO_ENTREGADO') {
      throw new AppError('FINALIZED_LOCK', 'El trámite está finalizado. Debes reabrir para editar.', {}, 409);
    }
  }

  private parseFecha(s: string): Date {
    const date = s.includes('T') ? new Date(s) : new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Fecha de pago invalida.', { fecha: s }, 400);
    }
    return date;
  }

  async list(tramiteId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { tramiteId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((p) => this.toResponse(p));
  }

  async create(tramiteId: string, dto: CreatePaymentDto, userId: string | undefined) {
    if (!userId) throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);

    const tramite = await this.prisma.tramite.findUnique({ where: { id: tramiteId } });
    if (!tramite) throw new AppError('NOT_FOUND', 'Tramite no existe.', { id: tramiteId }, 404);

    this.assertNotFinalizedOrCanceled(tramite);

    const created = await this.prisma.payment.create({
      data: {
        tramiteId,
        tipo: dto.tipo as any,
        valor: dto.valor,
        fecha: this.parseFecha(dto.fecha),
        medioPago: dto.medio_pago as any,
        notes: dto.notes ?? null,
        createdById: userId,
      },
    });

    return this.toResponse(created);
  }

  async update(tramiteId: string, paymentId: string, dto: UpdatePaymentDto) {
    const tramite = await this.prisma.tramite.findUnique({
      where: { id: tramiteId },
      select: { id: true, estadoActual: true },
    });
    if (!tramite) throw new AppError('NOT_FOUND', 'Tramite no existe.', { id: tramiteId }, 404);

    this.assertNotFinalizedOrCanceled(tramite);

    const existing = await this.prisma.payment.findFirst({
      where: { id: paymentId, tramiteId },
      select: { id: true },
    });

    if (!existing) {
      throw new AppError('PAYMENT_NOT_FOUND', 'Pago no encontrado.', { tramiteId, paymentId }, 404);
    }

    const data: {
      valor?: number;
      fecha?: Date;
      medioPago?: any;
      notes?: string | null;
    } = {};

    if (dto.valor !== undefined) data.valor = dto.valor;
    if (dto.fecha !== undefined) data.fecha = this.parseFecha(dto.fecha);
    if (dto.medio_pago !== undefined) data.medioPago = dto.medio_pago ?? 'OTRO';
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (Object.keys(data).length === 0) {
      const current = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });
      if (!current) {
        throw new AppError('PAYMENT_NOT_FOUND', 'Pago no encontrado.', { tramiteId, paymentId }, 404);
      }
      return this.toResponse(current);
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data,
    });

    return this.toResponse(updated);
  }

  async remove(tramiteId: string, paymentId: string) {
    const tramite = await this.prisma.tramite.findUnique({
      where: { id: tramiteId },
      select: { estadoActual: true },
    });

    if (tramite) {
      this.assertNotFinalizedOrCanceled(tramite);
    }

    const deleted = await this.prisma.payment.deleteMany({
      where: { id: paymentId, tramiteId },
    });

    if (deleted.count === 0) {
      throw new AppError('PAYMENT_NOT_FOUND', 'Pago no encontrado.', { tramiteId, paymentId }, 404);
    }

    return { ok: true };
  }
}

