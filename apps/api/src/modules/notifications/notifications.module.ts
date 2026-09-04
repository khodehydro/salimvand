import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { TelegramWebhookController } from './telegram.controller';
import { NotificationsService } from './notifications.service';
import { SocialPublisherService } from './social-publisher.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, TelegramWebhookController],
  providers: [NotificationsService, SocialPublisherService],
  exports: [NotificationsService, SocialPublisherService],
})
export class NotificationsModule {}
