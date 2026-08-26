import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

function context(ip = '192.0.2.1') {
  return { switchToHttp: () => ({ getRequest: () => ({ ip, socket: { remoteAddress: ip } }) }) } as never;
}

describe('LoginRateLimitGuard', () => {
  it('allows five attempts from one address', () => {
    const guard = new LoginRateLimitGuard();
    for (let i = 0; i < 5; i += 1) expect(guard.canActivate(context())).toBe(true);
  });
  it('rejects the sixth attempt with status 429', () => {
    const guard = new LoginRateLimitGuard();
    for (let i = 0; i < 5; i += 1) guard.canActivate(context());
    try { guard.canActivate(context()); expect.fail('expected rate limit'); } catch (error) { expect(error).toBeInstanceOf(HttpException); expect((error as HttpException).getStatus()).toBe(429); }
  });
  it('tracks different addresses independently', () => {
    const guard = new LoginRateLimitGuard();
    for (let i = 0; i < 5; i += 1) guard.canActivate(context('192.0.2.1'));
    expect(guard.canActivate(context('192.0.2.2'))).toBe(true);
  });
});
