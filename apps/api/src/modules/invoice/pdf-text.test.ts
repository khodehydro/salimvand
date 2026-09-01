import { describe, expect, it } from 'vitest';
import { faText } from './pdf-text';

describe('faText — Persian shaping for PDFKit', () => {
  it('maps Persian letters to their contextual presentation forms', () => {
    const shaped = faText('فاکتور');
    // Without shaping pdfkit draws raw codepoints (U+06xx) disconnected.
    expect([...shaped].some((char) => char.codePointAt(0)! >= 0xfe70)).toBe(true);
  });

  it('keeps Latin and digit runs readable inside the RTL line', () => {
    const shaped = faText('INV-000123');
    expect(shaped).toContain('INV-000123');
    expect(faText('مبلغ: 200000 ریال')).toContain('200000');
  });

  it('passes plain numbers and empty strings through untouched', () => {
    expect(faText('100000')).toBe('100000');
    expect(faText('')).toBe('');
    expect(faText(null)).toBe('');
  });

  it('shapes the Persian letters used across the invoice document', () => {
    for (const sample of ['فروشگاه سلیم وند', 'لنت جلو پژو', 'برگشتی', 'قابل پرداخت'])
      expect([...faText(sample)].some((char) => char.codePointAt(0)! >= 0xfe70)).toBe(true);
  });
});
