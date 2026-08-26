import { BadRequestException, ConflictException } from '@nestjs/common';

export function calculateNextQuantity(current: number, change: number, reason?: string): number {
  if (!Number.isInteger(change) || change === 0) throw new BadRequestException('تعداد باید عدد صحیح و غیرصفر باشد');
  if (change < 0 && !reason?.trim()) throw new BadRequestException('دلیل اصلاح موجودی الزامی است');
  const next = current + change;
  if (next < 0) throw new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'موجودی کافی نیست', current });
  return next;
}
