import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertNotFinalizedOrCanceled(tramite: { estadoActual: string }) {
    if (tramite.estadoActual === 'CANCELADO') {
      throw new AppError('CANCELED_LOCK', 'El trámite está cancelado. No se puede modificar.', {}, 409);
    }
    if (tramite.estadoActual === 'FINALIZADO_ENTREGADO') {
      throw new AppError('FINALIZED_LOCK', 'El trámite está finalizado. Debes reabrir para editar.', {}, 409);
    }
  }

  private parseFecha(s: string): Date {
    if (s.includes('T')) return new Date(s);
    return new Date(`${s}T00:00:00.000Z`);
  }

  async list(tramiteId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { tramiteId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(p => ({
      id: p.id,
      tipo: p.tipo,
      valor: p.valor,
      fecha: p.fecha.toISOString().slice(0, 10),
      medio_pago: p.medioPago,
      notes: p.notes ?? '',
    }));
  }

  async create(tramiteId: string, dto: CreatePaymentDto, userId: string) {
    const tramite = await this.prisma.tramite.findUnique({ where: { id: tramiteId } });
    if (!tramite) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: tramiteId }, 404);

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

    return {
      id: created.id,
      tipo: created.tipo,
      valor: created.valor,
      fecha: created.fecha.toISOString().slice(0, 10),
      medio_pago: created.medioPago,
      notes: created.notes ?? '',
    };
  }
}
