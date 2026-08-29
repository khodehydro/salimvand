import { Body, Controller, ForbiddenException, Post, Param } from '@nestjs/common';
import {
  NotificationsService,
  integrationConfigured,
  parseTelegramCommand,
} from './notifications.service';

/**
 * Telegram/Bale bot webhook (architecture doc §6.2). The secret in the URL is the
 * shared token configured as TELEGRAM_WEBHOOK_SECRET; without it every call is refused.
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post(':secret')
  async handle(@Param('secret') secret: string, @Body() body: { message?: { text?: string } }) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || secret !== expected)
      throw new ForbiddenException('webhook secret نامعتبر است');
    const { command } = parseTelegramCommand(body?.message?.text);
    if (!command) return { ok: true, data: { handled: false } };
    const reply = await this.notifications.answerCommand(body?.message?.text ?? '');
    if (integrationConfigured('telegram'))
      await this.notifications.enqueue({
        type: 'low-stock',
        testChannel: 'telegram',
        message: reply,
      });
    return { ok: true, data: { handled: true, command, reply } };
  }
}
