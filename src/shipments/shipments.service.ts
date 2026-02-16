import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { LinkShipmentDto } from './dto/link-shipment.dto';

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertNotFinalizedOrCanceled(tramite: { estadoActual: string }) {
    if (tramite.estadoActual === 'CANCELADO') {
      throw new AppError('CANCELED_LOCK', 'El trámite está cancelado. No se puede modificar.', {}, 409);
    }
    if (tramite.estadoActual === 'FINALIZADO_ENTREGADO') {
      throw new AppError('FINALIZED_LOCK', 'El trámite está finalizado. Debes reabrir para editar.', {}, 409);
    }
  }

  private parseFechaYYYYMMDD(s: string): Date {
    // acepta "YYYY-MM-DD" o ISO
    const date = s.includes('T') ? new Date(s) : new Date(`${s}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('VALIDATION_ERROR', 'Fecha de envio invalida.', { fecha_envio: s }, 400);
    }
    return date;
  }

  async list(tramiteId?: string) {
    if (tramiteId) {
      const links = await this.prisma.shipmentTramite.findMany({
        where: { tramiteId },
        include: { shipment: true },
        orderBy: { shipment: { fechaEnvio: 'desc' } } as any,
      });

      return links.map(l => ({
        id: l.shipment.id,
        numero_guia: l.shipment.numeroGuia,
        transportadora: l.shipment.transportadora,
        costo: l.shipment.costo,
        fecha_envio: l.shipment.fechaEnvio.toISOString().slice(0, 10),
        notes: l.shipment.notes ?? '',
      }));
    }

    const all = await this.prisma.shipment.findMany({
      orderBy: { fechaEnvio: 'desc' },
    });

    return all.map(s => ({
      id: s.id,
      numero_guia: s.numeroGuia,
      transportadora: s.transportadora,
      costo: s.costo,
      fecha_envio: s.fechaEnvio.toISOString().slice(0, 10),
      notes: s.notes ?? '',
    }));
  }

  async create(dto: CreateShipmentDto) {
    // Si viene tramiteId, validamos lock
    if (dto.tramiteId) {
      const t = await this.prisma.tramite.findUnique({ where: { id: dto.tramiteId } });
      if (!t) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: dto.tramiteId }, 404);
      this.assertNotFinalizedOrCanceled(t);
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        numeroGuia: dto.numero_guia,
        transportadora: dto.transportadora,
        costo: dto.costo,
        fechaEnvio: this.parseFechaYYYYMMDD(dto.fecha_envio),
        notes: dto.notes ?? null,
      },
    });

    // Si viene tramiteId, la asociamos (MVP cómodo)
    if (dto.tramiteId) {
      await this.prisma.shipmentTramite.create({
        data: { shipmentId: shipment.id, tramiteId: dto.tramiteId },
      });
    }

    return {
      id: shipment.id,
      numero_guia: shipment.numeroGuia,
      transportadora: shipment.transportadora,
      costo: shipment.costo,
      fecha_envio: shipment.fechaEnvio.toISOString().slice(0, 10),
      notes: shipment.notes ?? '',
    };
  }

  async link(shipmentId: string, dto: LinkShipmentDto) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new AppError('NOT_FOUND', 'Guía no existe.', { id: shipmentId }, 404);

    const tramite = await this.prisma.tramite.findUnique({ where: { id: dto.tramiteId } });
    if (!tramite) throw new AppError('NOT_FOUND', 'Trámite no existe.', { id: dto.tramiteId }, 404);

    this.assertNotFinalizedOrCanceled(tramite);

    if (dto.action === 'ADD') {
      await this.prisma.shipmentTramite.create({
        data: { shipmentId, tramiteId: dto.tramiteId },
      }).catch(() => {
        // si ya existe, no hacemos nada
      });

      return { ok: true };
    }

    // REMOVE
    await this.prisma.shipmentTramite.deleteMany({
      where: { shipmentId, tramiteId: dto.tramiteId },
    });

    return { ok: true };
  }
}
