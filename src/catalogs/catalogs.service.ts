import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  async concesionarios() {
    return this.prisma.concesionario.findMany({
      select: { code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async ciudades() {
    return this.prisma.ciudad.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
  }

  async documentTypes() {
    return this.prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, key: true, name: true, required: true },
      orderBy: { name: 'asc' },
    });
  }

  async alertRules() {
    return this.prisma.alertRule.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        fromEstado: true,
        toEstado: true,
        thresholdDays: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
