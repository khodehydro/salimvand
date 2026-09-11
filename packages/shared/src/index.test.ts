import { describe, expect, it } from 'vitest';
import {
  APP_NAME,
  buildProductSeo,
  createEan13,
  createSlug,
  extractAparatVideoId,
  extractMapEmbedUrl,
  formatJalaliDate,
  baladDirectionsUrl,
  geoIntentUrl,
  neshanRouteUrl,
  parseCoordinate,
  formatPersianNumber,
  formatGroupedPersian,
  formatRial,
  normalizeDigits,
  parseDigitsInput,
  validateSyncOperationEnvelope,
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
  it('builds navigation links for Neshan and the geo: chooser', () => {
    expect(neshanRouteUrl(36.9692, 46.1027, { lat: 35.7, lng: 51.4 })).toBe(
      'https://nshn.ir/maps?origin=35.7,51.4&destination=36.9692,46.1027&type=drive',
    );
    expect(neshanRouteUrl(36.9692, 46.1027)).toBe('https://nshn.ir/?lat=36.9692&lng=46.1027');
    expect(geoIntentUrl(36.9692, 46.1027)).toBe('geo:36.9692,46.1027');
    expect(baladDirectionsUrl(36.9680048, 46.0856154)).toBe(
      'https://balad.ir/directions/driving?destination=46.0856154%2C36.9680048#15/36.9680048/46.0856154',
    );
    expect(geoIntentUrl(36.9692, 46.1027, 'فروشگاه سلیم وند')).toBe(
      `geo:36.9692,46.1027?q=36.9692,46.1027(${encodeURIComponent('فروشگاه سلیم وند')})`,
    );
    expect(parseCoordinate('۳۶/۹۶۹۲'.replace('/', '.'))).toBe(36.9692);
    expect(parseCoordinate('46.1027')).toBe(46.1027);
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('abc')).toBeNull();
  });
  it('normalizes Persian and Arabic digits to ASCII', () => {
    expect(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeDigits('٠١٢٣')).toBe('0123');
    expect(normalizeDigits('+98 441 ۰۹۱۲')).toBe('+98 441 0912');
  });
  it('groups money into Persian digits (fa-IR thousands separator)', () => {
    expect(formatGroupedPersian(0)).toBe('۰');
    expect(formatGroupedPersian(999)).toBe('۹۹۹');
    expect(formatGroupedPersian(1000)).toBe('۱٬۰۰۰');
    expect(formatGroupedPersian(1234567)).toBe('۱٬۲۳۴٬۵۶۷');
    // bigint (Prisma money) and numeric strings keep full precision
    expect(formatGroupedPersian(90000000000000n)).toBe('۹۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰');
    expect(formatGroupedPersian('145000000')).toBe('۱۴۵٬۰۰۰٬۰۰۰');
    expect(formatRial(1500000)).toBe('۱٬۵۰۰٬۰۰۰ ریال');
    expect(formatRial(20000000n)).toBe('۲۰٬۰۰۰٬۰۰۰ ریال');
    expect(formatRial('1250000')).toBe('۱٬۲۵۰٬۰۰۰ ریال');
    expect(formatPersianNumber('09123456789')).toBe('۰۹۱۲۳۴۵۶۷۸۹');
    expect(formatPersianNumber('INV-000123')).toBe('INV-۰۰۰۱۲۳');
  });
  it('parses typed digit input back to plain ASCII digits', () => {
    expect(parseDigitsInput('1200000')).toBe('1200000');
    expect(parseDigitsInput('۱٬۲۰۰٬۰۰۰')).toBe('1200000');
    expect(parseDigitsInput('1,200,000')).toBe('1200000');
    expect(parseDigitsInput('۱/۲۰۰/۰۰۰')).toBe('1200000');
    expect(parseDigitsInput('٠١٢٣')).toBe('123'); // leading zero collapses like money inputs
    expect(parseDigitsInput('007')).toBe('7');
    expect(parseDigitsInput('0')).toBe('0');
    expect(parseDigitsInput('')).toBe('');
    expect(parseDigitsInput('مبلغ: ۱۲۰۰۰')).toBe('12000');
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
  it('validates canonical offline operation envelopes', () => {
    const valid = validateSyncOperationEnvelope({
      operationId: 'android-2026-0001',
      deviceId: 'phone-a',
      type: 'invoice.pay',
      payload: { invoiceId: 'inv-1', amount: '1000', method: 'cash' },
    });
    expect(valid.ok).toBe(true);
    expect(validateSyncOperationEnvelope(null).ok).toBe(false);
    expect(validateSyncOperationEnvelope({ operationId: 'short', deviceId: 'phone-a', type: 'invoice.pay', payload: {} }).ok).toBe(false);
    expect(validateSyncOperationEnvelope({ operationId: 'android-2026-0002', deviceId: 'phone-a', type: 'unsupported', payload: {} }).ok).toBe(false);
    expect(validateSyncOperationEnvelope({ operationId: 'android-2026-0003', deviceId: 'phone-a', type: 'invoice.pay', payload: [] }).ok).toBe(false);
  });
  it('formats Jalali dates with Persian digits', () => {
    const formatted = formatJalaliDate(new Date('2026-08-27T12:00:00Z'));
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatJalaliDate('invalid')).toBe('');
  });
});
