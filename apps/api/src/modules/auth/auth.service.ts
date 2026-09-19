import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';

import { UserRole } from '@salimvand/shared';

export type AuthUser = { id: string; username: string; name: string; role: UserRole };

@Injectable()
export class AuthService {
  constructor(private readonly prisma?: PrismaService) {}

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

  async requestPasswordReset(username: string) {
    if (!this.prisma) throw new BadRequestException('سرویس بازیابی آماده نیست');
    const user = await this.prisma.user.findFirst({ where: { username: username.trim(), isActive: true } });
    if (user) {
      const setting = await this.prisma.setting.findUnique({ where: { key: 'integrations.messaging' } });
      const config = (setting?.value ?? {}) as { telegram?: { botToken?: string; passwordRecoveryChatId?: string; apiBase?: string; proxySecret?: string } };
      const botToken = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = config.telegram?.passwordRecoveryChatId || process.env.TELEGRAM_PASSWORD_RESET_CHAT_ID;
      if (!botToken || !chatId) throw new BadRequestException('ربات تلگرام بازیابی پیکربندی نشده است');
      const raw = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
      const site = process.env.ADMIN_URL ?? 'https://cms.salimvand.ir';
      const link = `${site}/reset-password?token=${raw}`;
      const base = (config.telegram?.apiBase || process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
      const response = await fetch(`${base}/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json', ...(config.telegram?.proxySecret ? { 'x-proxy-secret': config.telegram.proxySecret } : {}) }, body: JSON.stringify({ chat_id: chatId, text: `درخواست بازیابی رمز\nکاربر: ${user.username}\n\nلینک ۱۵ دقیقه معتبر است:\n${link}` }) });
      if (!response.ok) throw new BadRequestException('ارسال پیام تلگرام ناموفق بود');
    }
    return { ok: true, message: 'اگر کاربر معتبر باشد، لینک بازیابی برای مدیر ارسال می‌شود.' };
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
