import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { APP_NAME, API_PREFIX } from '@salimvand/shared';
import { NotificationsService } from './modules/notifications/notifications.service';
import { PrismaService } from './prisma.service';

@Controller()
export class SystemController {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  @Get('health')
  health() {
    return { ok: true, data: { service: 'api', name: APP_NAME, prefix: API_PREFIX, database: 'configured' } };
  }

  @Get('health/ready')
  async readiness() {
    // The database is mandatory; the notification queue is best-effort and must
    // not block the release when Redis is temporarily unavailable.
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('پایگاه داده در دسترس نیست');
    }
    let queue = 'ready';
    try {
      await this.notifications.checkQueueConnection();
    } catch (err) {
      queue = 'degraded';
      console.warn('[health] notification queue unavailable:', (err as Error)?.message ?? err);
    }
    return { ok: true, data: { service: 'api', database: 'ready', queue } };
  }
}
