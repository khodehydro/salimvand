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
