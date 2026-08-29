import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { UserRole } from '@salimvand/shared';

export type AuthUser = { id: string; username: string; name: string; role: UserRole };

@Injectable()
export class AuthService {
  private readonly accessSecret =
    process.env.JWT_ACCESS_SECRET ?? 'development-access-secret-change-me';
  private readonly refreshSecret =
    process.env.JWT_REFRESH_SECRET ?? 'development-refresh-secret-change-me';

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
  issueAccessToken(user: AuthUser): string {
    return jwt.sign({ sub: user.id, username: user.username, role: user.role }, this.accessSecret, {
      expiresIn: '15m',
    });
  }
  issueRefreshToken(user: AuthUser): string {
    return jwt.sign(
      { sub: user.id, username: user.username, role: user.role, kind: 'refresh' },
      this.refreshSecret,
      { expiresIn: '7d' },
    );
  }
  verifyAccessToken(token: string): AuthUser {
    return this.verify(token, this.accessSecret, false);
  }
  verifyRefreshToken(token: string): AuthUser {
    return this.verify(token, this.refreshSecret, true);
  }
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private verify(token: string, secret: string, refresh: boolean): AuthUser {
    try {
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      if (
        !payload.sub ||
        typeof payload.username !== 'string' ||
        typeof payload.role !== 'string' ||
        (refresh && payload.kind !== 'refresh')
      )
        throw new Error('invalid');
      return {
        id: String(payload.sub),
        username: payload.username,
        name: payload.username,
        role: payload.role as UserRole,
      };
    } catch {
      throw new UnauthorizedException('توکن نامعتبر است');
    }
  }
}
