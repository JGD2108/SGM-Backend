import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/errors/exception.filter';

function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({
    origin: (origin, callback) => {
      // Electron/file:// and server-to-server requests may come without Origin.
      if (!origin || origin === 'null') {
        callback(null, true);
        return;
      }

      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (nodeEnv !== 'production' && /localhost|127\.0\.0\.1/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  const swaggerEnabled = process.env.SWAGGER_ENABLED === 'true' || nodeEnv !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('SGM API')
      .setDescription('Backend SGM (Tramites, Archivos, Pagos, Envios)')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
