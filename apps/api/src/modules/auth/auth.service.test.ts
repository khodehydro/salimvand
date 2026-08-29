import { describe, expect, it } from 'vitest';
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
});
