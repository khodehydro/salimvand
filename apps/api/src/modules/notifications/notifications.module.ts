import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { TelegramWebhookController } from './telegram.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, TelegramWebhookController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
