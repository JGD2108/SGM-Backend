import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors/app-error';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive) {
      throw new AppError('INVALID_CREDENTIALS', 'Credenciales inválidas.', {}, 401);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new AppError('INVALID_CREDENTIALS', 'Credenciales inválidas.', {}, 401);
    }

    const secretStr = this.config.get<string>('JWT_SECRET');
    const expiresRaw = this.config.get<string>('JWT_EXPIRES_IN') ?? '8h';

    if (!secretStr) {
      throw new Error('JWT_SECRET no está definido en .env');
    }

    // ✅ jsonwebtoken types recientes: expiresIn usa StringValue | number (tipo especial)
    const secret = secretStr as jwt.Secret;
    const options: jwt.SignOptions = {
      expiresIn: expiresRaw as unknown as jwt.SignOptions['expiresIn'],
    };

    const token = jwt.sign(
      { sub: user.id, email: user.email, name: user.name },
      secret,
      options,
    );

    return {
      accessToken: token,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);
    }

    return { id: user.id, name: user.name, email: user.email };
  }
}
