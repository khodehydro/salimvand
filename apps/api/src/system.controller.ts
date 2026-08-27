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
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.notifications.checkQueueConnection()]);
      return { ok: true, data: { service: 'api', database: 'ready', queue: 'ready' } };
    } catch {
      throw new ServiceUnavailableException('پایگاه داده در دسترس نیست');
    }
  }
}
