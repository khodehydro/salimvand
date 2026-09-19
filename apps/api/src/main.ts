import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { dirname, join } from 'node:path';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { ResponseTimeInterceptor } from './common/http/response-time.interceptor';
import { AppModule } from './app.module';
import { corsOrigins, validateRuntimeConfig } from './common/config/runtime-config';

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app
    .getHttpAdapter()
    .getInstance()
    .set('json replacer', (_key: string, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  app.setGlobalPrefix('api/v1');
  // Uploaded files (product images + site logo/favicon) are public content:
  // the storefront serves them from /uploads via Nginx and the CMS needs the
  // same path, so the API exposes the uploads root under /uploads as well.
  const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products');
  app.useStaticAssets(dirname(uploadDir), {
    prefix: '/uploads',
    maxAge: '30d',
    immutable: true,
    index: false,
    redirect: false,
  });
  app.use(cookieParser());
  // Uploaded images are public assets that may be referenced from the CMS and
  // the storefront; allow them to load cross-origin (API domain direct links).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useGlobalFilters(new ApiExceptionFilter());
  // Server-side handling time on every response (X-Response-Time header +
  // a console.warn line for slow routes) so latency can be attributed to
  // the network or the server without guessing.
  app.useGlobalInterceptors(new ResponseTimeInterceptor());
  app.enableCors({ origin: corsOrigins(process.env.CORS_ORIGINS), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(
    Number(process.env.API_PORT ?? 4000),
    process.env.API_HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),
  );
}

void bootstrap();
