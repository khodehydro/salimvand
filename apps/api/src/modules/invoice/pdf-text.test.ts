import { describe, expect, it } from 'vitest';
import { faText } from './pdf-text';

// The API compiles without esModuleInterop, so a default import from a CJS
// package breaks in dist (bidi_js_1.default is not a function) even though
// vitest's transform happily accepts it. Guard the raw CJS export shape that
// `import bidiFactory = require('bidi-js')` relies on: require('bidi-js')
// must BE the factory function itself.
/* eslint-disable @typescript-eslint/no-require-imports */
const nodeRequire: NodeRequire = require;

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

describe('bidi-js CJS export shape (dist compatibility)', () => {
  it('exports the factory function itself, not a default wrapper', () => {
    const mod = nodeRequire('bidi-js');
    expect(typeof mod).toBe('function');
    expect(typeof mod()).toBe('object');
  });
});
