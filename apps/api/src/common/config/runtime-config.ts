import { BadRequestException } from '@nestjs/common';

export function corsOrigins(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): true | string[] {
  if (!value) return nodeEnv === 'production' ? [] : true;
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !env[key] || env[key]?.startsWith('replace-with-'));
  if (missing.length)
    throw new BadRequestException(`تنظیمات ضروری محیط کامل نیست: ${missing.join(', ')}`);
}
