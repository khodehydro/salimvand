import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

type Attempt = { count: number; resetAt: number };
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, Attempt>();
  private readonly windowMs = 5 * 60 * 1000;
  private readonly maxAttempts = 5;
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = String(request.ip ?? request.socket.remoteAddress ?? 'unknown');
    const now = Date.now();
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.maxAttempts)
      throw new HttpException('تعداد تلاش ورود بیش از حد مجاز است', HttpStatus.TOO_MANY_REQUESTS);
    current.count += 1;
    return true;
  }
}
