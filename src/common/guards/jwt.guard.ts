import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../errors/app-error';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'No autenticado.', {}, 401);
    }

    const token = header.slice('Bearer '.length).trim();
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET no está definido');

    try {
      const payload = jwt.verify(token, secret) as any;
      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      return true;
    } catch {
      throw new AppError('UNAUTHORIZED', 'Token inválido o expirado.', {}, 401);
    }
  }
}
