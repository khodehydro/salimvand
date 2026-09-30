import { Body, Controller, ForbiddenException, Post, Param } from '@nestjs/common';
import {
  NotificationsService,
  integrationConfigured,
  parseTelegramCommand,
} from './notifications.service';

/** Telegram Bot API 9.4+ button styles: primary (blue), success (green), danger (red). */
export function buildBotCommandKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 موجودی فعال', callback_data: 'stock', style: 'primary' as const },
        { text: '⚠️ اقلام ناموجود', callback_data: 'low', style: 'danger' as const },
      ],
      [
        { text: '💰 فروش امروز', callback_data: 'sales', style: 'success' as const },
        { text: '🌐 وب‌سایت سلیم‌وند', url: 'https://salimvand.ir', style: 'primary' as const },
      ],
    ],
  };
}

/**
 * Telegram/Bale bot webhook (architecture doc §6.2). The secret in the URL is the
 * shared token configured as TELEGRAM_WEBHOOK_SECRET; without it every call is refused.
 */
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post(':secret')
  async handle(
    @Param('secret') secret: string,
    @Body()
    body: {
      message?: { text?: string };
      callback_query?: { data?: string };
    },
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || secret !== expected)
      throw new ForbiddenException('webhook secret نامعتبر است');
    const rawText = body?.message?.text ?? (body?.callback_query?.data ? `/${body.callback_query.data}` : '');
    const { command } = parseTelegramCommand(rawText);
    if (!command) return { ok: true, data: { handled: false } };
    const reply = await this.notifications.answerCommand(rawText);
    if (integrationConfigured('telegram'))
      await this.notifications.enqueue({
        type: 'low-stock',
        testChannel: 'telegram',
        message: reply,
      });
    return { ok: true, data: { handled: true, command, reply, keyboard: buildBotCommandKeyboard() } };
  }
}
