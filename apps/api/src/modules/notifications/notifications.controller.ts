import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
