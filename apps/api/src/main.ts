import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { AppModule } from './app.module';
import { corsOrigins, validateRuntimeConfig } from './common/config/runtime-config';

async function bootstrap() {
  validateRuntimeConfig();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: corsOrigins(process.env.CORS_ORIGINS), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(Number(process.env.API_PORT ?? 4000), '0.0.0.0');
}

void bootstrap();
