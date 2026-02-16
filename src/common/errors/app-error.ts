import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly details: any = {},
    status: number = 400,
  ) {
    super({ errorCode, message, details }, status);
  }
}
