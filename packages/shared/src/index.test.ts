import { describe, expect, it } from 'vitest';
import {
  APP_NAME,
  buildProductSeo,
  createEan13,
  createSlug,
  formatJalaliDate,
  formatPersianNumber,
  formatRial,
} from './index';

describe('shared utilities', () => {
  it('exposes the store identity', () => expect(APP_NAME).toBe('فروشگاه سلیم وند'));
  it('formats Persian numbers and rial amounts', () => {
    expect(formatPersianNumber(1205)).toBe('۱۲۰۵');
    expect(formatRial(1205)).toContain('ریال');
  });
  it('creates stable SEO slugs', () =>
    expect(createSlug('قاب ستون بالای پژو ۲۰۶')).toBe('قاب-ستون-بالای-پژو-۲۰۶'));
  it('creates valid EAN-13 values with a check digit', () => {
    const barcode = createEan13('123456789');
    expect(barcode).toHaveLength(13);
    expect(barcode.startsWith('626')).toBe(true);
  });
  it('produces distinct barcodes for seeds that differ only by prefix', () => {
    const codes = ['BRK-00001', 'FLT-00001', 'BLT-00001', 'ENG-00001', 'LGT-00001', 'BRK-00002'];
    const barcodes = codes.map((code) => createEan13(code));
    expect(new Set(barcodes).size).toBe(codes.length);
    for (const code of codes) {
      const barcode = createEan13(code);
      expect(barcode).toHaveLength(13);
      expect(barcode.startsWith('626')).toBe(true);
    }
  });
  it('keeps 9-digit entropy for purely numeric seeds like timestamps', () => {
    const first = createEan13('177000012345');
    const second = createEan13('177000019999');
    expect(first).not.toBe(second);
    expect(first).toHaveLength(13);
    expect(second).toHaveLength(13);
  });
  it('generates product SEO defaults', () => {
    const seo = buildProductSeo({ name: 'قاب ستون', vehicleNames: ['پژو ۲۰۶'] });
    expect(seo.seoTitle).toContain('قاب ستون');
    expect(seo.seoDescription).toContain('میاندوآب');
  });
  it('formats Jalali dates with Persian digits', () => {
    const formatted = formatJalaliDate(new Date('2026-08-27T12:00:00Z'));
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatJalaliDate('invalid')).toBe('');
  });
});
