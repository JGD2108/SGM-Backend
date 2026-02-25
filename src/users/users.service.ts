import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function normalizeSearch(raw: string | undefined): string | null {
  const q = String(raw ?? '').trim();
  return q.length > 0 ? q : null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(qRaw?: string) {
    const q = normalizeSearch(qRaw);
    const where: Prisma.UserWhereInput = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      items: users.map((user) => ({
        id: user.id,
        nombre: user.name,
        name: user.name,
        email: user.email,
        telefono: null,
        phone: null,
        rol: null,
        role: null,
        activo: user.isActive,
        is_active: user.isActive,
        status: user.isActive ? 'active' : 'inactive',
        created_at: user.createdAt.toISOString(),
      })),
      total,
    };
  }
}
