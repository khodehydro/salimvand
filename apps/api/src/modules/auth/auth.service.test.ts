import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const service = new AuthService();
  const user = { id: 'user-1', username: 'seller', name: 'Seller', role: 'seller' as const };

  it('hashes and verifies passwords with argon2id', async () => {
    const hash = await service.hashPassword('a-strong-password-123');
    expect(hash).not.toContain('a-strong-password-123');
    expect(await service.verifyPassword(hash, 'a-strong-password-123')).toBe(true);
    expect(await service.verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('issues and verifies access tokens', () => {
    const token = service.issueAccessToken(user);
    expect(service.verifyAccessToken(token)).toMatchObject({
      id: user.id,
      username: user.username,
      role: user.role,
    });
  });

  it('rejects an access token as a refresh token', () => {
    const token = service.issueAccessToken(user);
    expect(() => service.verifyRefreshToken(token)).toThrow();
  });

  it('normalizes Persian digits and handles chat not found error in password reset', async () => {
    const originalFetch = global.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
        status: 400,
      });
    }) as never;

    const prisma = {
      user: { findFirst: vi.fn(async () => ({ id: 'u1', username: 'admin', isActive: true })) },
      setting: {
        findUnique: vi.fn(async () => ({
          value: { telegram: { botToken: 'tok', passwordRecoveryChatId: '۱۲۳۴۵۶' } },
        })),
      },
      passwordResetToken: {
        deleteMany: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
    };

    const authService = new AuthService(prisma as never);

    try {
      await expect(authService.requestPasswordReset('admin')).rejects.toThrow(
        'چت پیدا نشد — لطفاً ابتدا با اکانت تلگرام وارد ربات شوید و دکمه Start را بزنید',
      );
      expect(calls[0].body.chat_id).toBe('123456');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('provides descriptive error when bot cannot initiate conversation', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ ok: false, description: "Forbidden: bot can't initiate conversation with a user" }),
        { status: 403 },
      );
    }) as never;

    const prisma = {
      user: { findFirst: vi.fn(async () => ({ id: 'u1', username: 'admin', isActive: true })) },
      setting: {
        findUnique: vi.fn(async () => ({
          value: { telegram: { botToken: 'tok', passwordRecoveryChatId: '123456' } },
        })),
      },
      passwordResetToken: {
        deleteMany: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
    };

    const authService = new AuthService(prisma as never);

    try {
      await expect(authService.requestPasswordReset('admin')).rejects.toThrow(
        'ربات اجازه ارسال پیام به شما را ندارد — لطفاً ابتدا در تلگرام وارد ربات شوید و دکمه Start را بزنید',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
