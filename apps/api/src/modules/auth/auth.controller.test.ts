import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

function response() {
  return {
    cookies: [] as unknown[],
    clear: undefined as unknown,
    cookie(name: string, value: string, options: unknown) {
      this.cookies.push({ name, value, options });
    },
    clearCookie(name: string, options: unknown) {
      this.clear = { name, options };
    },
  };
}
function makeController() {
  const auth = {
    verifyPassword: vi.fn(),
    issueRefreshToken: vi.fn(() => 'refresh'),
    issueAccessToken: vi.fn(() => 'access'),
    hashRefreshToken: vi.fn(() => 'hash'),
    verifyRefreshToken: vi.fn(),
  };
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { controller: new AuthController(auth as never, prisma as never), auth, prisma };
}

describe('AuthController', () => {
  it('rejects incomplete login input with the standard validation response', async () => {
    const { controller } = makeController();
    await expect(controller.login({}, {} as never, response() as never)).resolves.toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'نام کاربری و رمز عبور الزامی است' },
    });
  });
  it('issues access token and secure refresh cookie after valid login', async () => {
    const { controller, auth, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      username: 'admin',
      name: 'مدیر',
      role: 'super_admin',
      isActive: true,
      passwordHash: 'hash',
    });
    auth.verifyPassword.mockResolvedValue(true);
    const res = response();
    await expect(
      controller.login({ username: 'admin', password: 'secret' }, {} as never, res as never),
    ).resolves.toMatchObject({
      ok: true,
      data: { accessToken: 'access', user: { id: 'u1', role: 'super_admin' } },
    });
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0]).toMatchObject({ name: 'salimvand.refresh', value: 'refresh' });
  });
  it('rejects invalid credentials', async () => {
    const { controller, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      controller.login({ username: 'bad', password: 'bad' }, {} as never, response() as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('clears refresh cookie on logout', () => {
    const { controller } = makeController();
    const res = response();
    expect(controller.logout(undefined, { cookies: {} } as never, res as never)).toEqual({
      ok: true,
      data: null,
    });
    expect(res.clear).toMatchObject({ name: 'salimvand.refresh' });
  });
});
