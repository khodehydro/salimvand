import { describe, expect, it } from 'vitest';
import {
  APP_NAME,
  buildProductSeo,
  createEan13,
  createSlug,
  extractAparatVideoId,
  extractMapEmbedUrl,
  formatJalaliDate,
  formatPersianNumber,
  formatRial,
  normalizeDigits,
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
  it('extracts Aparat video hashes from every paste format', () => {
    expect(extractAparatVideoId('AbCdEf123')).toBe('AbCdEf123');
    expect(extractAparatVideoId('https://www.aparat.com/v/AbCdEf123')).toBe('AbCdEf123');
    expect(extractAparatVideoId('https://www.aparat.com/v/XyZ9?playlist=1')).toBe('XyZ9');
    expect(
      extractAparatVideoId('https://www.aparat.com/video/video/embed/videohash/QwEr123/vt/frame'),
    ).toBe('QwEr123');
    expect(extractAparatVideoId('')).toBe('');
    expect(extractAparatVideoId('نه-معتبر!')).toBe('');
  });
  it('normalizes Persian and Arabic digits to ASCII', () => {
    expect(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeDigits('٠١٢٣')).toBe('0123');
    expect(normalizeDigits('+98 441 ۰۹۱۲')).toBe('+98 441 0912');
  });
  it('extracts embeddable map URLs from any paste format', () => {
    const embed = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4080.abc';
    expect(extractMapEmbedUrl(embed)).toBe(embed);
    expect(extractMapEmbedUrl(`<iframe src="${embed}" width="600"></iframe>`)).toBe(embed);
    expect(extractMapEmbedUrl('!1m18!1m12!1m3!1d4080.xyz')).toBe(
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4080.xyz',
    );
    const osm = 'https://www.openstreetmap.org/export/embed.html?bbox=46.06%2C36.94';
    expect(extractMapEmbedUrl(osm)).toBe(osm);
    // Google share links cannot be framed — they must be rejected.
    expect(extractMapEmbedUrl('https://maps.app.goo.gl/AbCdEf?g_st=ic')).toBe('');
    expect(extractMapEmbedUrl('https://www.google.com/maps/place/Miandoab')).toBe('');
    expect(extractMapEmbedUrl('')).toBe('');
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
