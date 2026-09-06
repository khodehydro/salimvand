import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { LoginRateLimitGuard } from '../../common/auth/login-rate-limit.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() body: { username?: string; password?: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!body.username || !body.password)
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'نام کاربری و رمز عبور الزامی است' },
      };
    const user = await this.prisma.user.findUnique({ where: { username: body.username } });
    if (
      !user ||
      !user.isActive ||
      !(await this.auth.verifyPassword(user.passwordHash, body.password))
    )
      throw new UnauthorizedException('نام کاربری یا رمز عبور صحیح نیست');
    const authUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    const refreshToken = this.auth.issueRefreshToken(authUser);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.auth.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdByIp: request.ip,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    response.cookie('salimvand.refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
    return {
      ok: true,
      data: { accessToken: this.auth.issueAccessToken(authUser), user: authUser },
    };
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email?: string }) {
    return this.auth.requestPasswordReset(body.email ?? '');
  }

  @Post('reset-password')
  resetPassword(@Body() body: { token?: string; password?: string }) {
    return this.auth.resetPassword(body.token ?? '', body.password ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() request: Request) {
    const user = (request as Request & { user?: { id: string } }).user;
    if (!user) throw new UnauthorizedException('نیاز به ورود دارید');
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, username: true, role: true, mobile: true, isActive: true },
    });
    if (!record?.isActive) throw new UnauthorizedException('کاربر فعال نیست');
    return { ok: true, data: record };
  }

  @Post('refresh')
  async refresh(
    @Body('refreshToken') fallback: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token =
      fallback ?? (request.cookies as Record<string, string> | undefined)?.['salimvand.refresh'];
    if (!token) throw new UnauthorizedException('رفرش توکن ارسال نشده است');
    const user = this.auth.verifyRefreshToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.auth.hashRefreshToken(token) },
    });
    if (!stored || stored.userId !== user.id || stored.revokedAt || stored.expiresAt <= new Date())
      throw new UnauthorizedException('رفرش توکن منقضی یا باطل شده است');
    const nextToken = this.auth.issueRefreshToken(user);
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: this.auth.hashRefreshToken(nextToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdByIp: request.ip,
        },
      }),
    ]);
    response.cookie('salimvand.refresh', nextToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth',
    });
    return { ok: true, data: { accessToken: this.auth.issueAccessToken(user) } };
  }

  @Post('logout')
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = (request.cookies as Record<string, string> | undefined)?.['salimvand.refresh'];
    response.clearCookie('salimvand.refresh', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
    if (!token) return { ok: true, data: null };
    return this.prisma.refreshToken
      .updateMany({
        where: { tokenHash: this.auth.hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then(() => ({ ok: true, data: null }));
  }
}
