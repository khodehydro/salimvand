import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('manager')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get('queue') queue() { return this.notifications.counts().then((counts) => ({ ok: true, data: counts })); }
  @Get('health') health() { return this.notifications.health().then((health) => ({ ok: true, data: health })); }
  @Get('failed') failed(@Query('limit') limit?: string) { return this.notifications.failed(Number(limit ?? 50)).then((jobs) => ({ ok: true, data: jobs })); }
  @Post('failed/:id/retry') async retry(@Param('id') id: string) { const retried = await this.notifications.retry(id); return { ok: retried, data: { retried } }; }
}
