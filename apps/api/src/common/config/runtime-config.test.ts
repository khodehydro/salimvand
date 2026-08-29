import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { corsOrigins, validateRuntimeConfig } from './runtime-config';

describe('runtime config', () => {
  it('allows permissive CORS only outside production when no origin is configured', () => {
    expect(corsOrigins(undefined, 'development')).toBe(true);
    expect(corsOrigins(undefined, 'production')).toEqual([]);
  });
  it('parses a comma-separated allowlist and removes empty entries', () => {
    expect(
      corsOrigins(' https://salimvand.ir, , https://cms.salimvand.ir, ', 'production'),
    ).toEqual(['https://salimvand.ir', 'https://cms.salimvand.ir']);
  });
  it('requires production secrets', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'production' })).toThrow(BadRequestException);
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db',
        JWT_ACCESS_SECRET: 'access',
        JWT_REFRESH_SECRET: 'refresh',
      }),
    ).not.toThrow();
  });
});
