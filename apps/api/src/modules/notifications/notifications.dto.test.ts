import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TestNotificationDto } from './notifications.dto';

describe('Notification test DTO', () => {
  it('accepts a provider test payload', async () => {
    expect(
      await validate(
        plainToInstance(TestNotificationDto, { channel: 'telegram', message: 'سلام' }),
      ),
    ).toHaveLength(0);
  });
  it('rejects unsupported providers and oversized messages', async () => {
    expect(
      (
        await validate(
          plainToInstance(TestNotificationDto, { channel: 'whatsapp', message: 'سلام' }),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(TestNotificationDto, { channel: 'sms', mobile: 'bad', message: 'سلام' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
