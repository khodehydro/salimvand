import { normalizeDigits } from '@salimvand/shared';

/** Prepare a draft only: the device's messaging app owns sending and consent. */
export function smsInquiryHref(phone: string, productName: string, ios = false): string | null {
  const recipient = normalizeDigits(phone.replace(/^tel:/i, '')).replace(/[\s().-]/g, '');
  // Never let pasted query parameters, extra recipients or another URI scheme
  // become part of the SMS destination. Missing/invalid numbers get no link.
  if (!/^\+?\d{3,15}$/.test(recipient)) return null;
  const body = `سلام\n\n${productName} موجود هست؟\n\nقیمت چنده؟`;
  // iOS uses &body directly after the recipient; Android uses ?body.
  return `sms:${recipient}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`;
}
