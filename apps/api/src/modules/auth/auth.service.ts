import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { EmailService } from './email.service';
import { UserRole } from '@salimvand/shared';

export type AuthUser = { id: string; username: string; name: string; role: UserRole };

@Injectable()
export class AuthService {
  constructor(private readonly prisma?: PrismaService, private readonly email?: EmailService) {}

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

  async requestPasswordReset(emailAddress: string) {
    const email = emailAddress.trim().toLowerCase();
    if (!this.prisma || !this.email) throw new BadRequestException('سرویس ایمیل آماده نیست');
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true } });
    // Do not reveal whether an email exists.
    if (user) {
      const raw = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
      const site = process.env.ADMIN_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://salimvand.ir';
      await this.email.sendPasswordReset(user.email!, user.name, `${site}/reset-password?token=${raw}`);
    }
    return { ok: true, message: 'اگر ایمیل ثبت شده باشد، لینک بازیابی ارسال می‌شود.' };
  }

  async resetPassword(token: string, password: string) {
    if (!this.prisma) throw new BadRequestException('سرویس بازیابی آماده نیست');
    if (!token || password.length < 10) throw new BadRequestException('توکن و رمز حداقل ۱۰ کاراکتری الزامی است');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await this.prisma.passwordResetToken.findFirst({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } } });
    if (!record) throw new BadRequestException('لینک بازیابی نامعتبر یا منقضی شده است');
    const passwordHash = await this.hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true, message: 'رمز عبور با موفقیت تغییر کرد.' };
  }

  private verify(token: string, secret: string, refresh: boolean) {
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
