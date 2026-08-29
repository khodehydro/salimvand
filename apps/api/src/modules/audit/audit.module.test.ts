import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from './audit.module';

describe('AuditModule', () => {
  it('imports AuthModule so JwtAuthGuard can resolve AuthService at startup', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AuditModule) as unknown[];
    expect(imports).toContain(AuthModule);
  });
});
