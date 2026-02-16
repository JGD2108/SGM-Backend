import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;

      // Normalizar errores de ValidationPipe
      if (status === HttpStatus.BAD_REQUEST && body?.message && Array.isArray(body.message)) {
        return res.status(status).json({
          errorCode: 'VALIDATION_ERROR',
          message: 'Datos inválidos.',
          details: { issues: body.message },
        });
      }

      if (body?.errorCode && body?.message) {
        return res.status(status).json(body);
      }

      return res.status(status).json({
        errorCode: 'HTTP_ERROR',
        message: body?.message ?? 'Error',
        details: body,
      });
    }

    return res.status(500).json({
      errorCode: 'INTERNAL_ERROR',
      message: 'Error interno.',
      details: {},
    });
  }
}
