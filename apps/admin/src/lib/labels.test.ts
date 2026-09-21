import { describe, expect, it } from 'vitest';
import {
  LABEL_CSS,
  barcodeSVG,
  buildSheetHTML,
  code128Bits,
  ean13Bits,
  ean13CheckDigit,
  ean13FromSku,
  renderLabelHTML,
  renderShelfLabelHTML,
  type LabelOptions,
  type ShelfLabelOptions,
} from './labels';

const base: LabelOptions = {
  name: 'لنت ترمز جلو پژو ۲۰۶',
  sku: 'BRK-00452',
  code: '6261234567890',
  category: 'ترمز',
  cars: '۲۰۶ تیپ ۲ و ۵ · ۲۰۷',
  size: '50x30',
  style: 'brand',
  type: 'ean13',
  showSku: true,
  showMeta: true,
  showFoot: true,
};

describe('ean13FromSku / check digit', () => {
  it('builds a stable Iran-prefixed EAN-13 from a SKU', () => {
    const code = ean13FromSku('BRK-00452');
    expect(code).toHaveLength(13);
    expect(code.startsWith('626')).toBe(true);
    expect(code[12]).toBe(ean13CheckDigit(code.slice(0, 12)));
    // deterministic
    expect(ean13FromSku('BRK-00452')).toBe(code);
  });
  it('repairs a wrong check digit', () => {
    const fixed = ean13Bits('6261234567890');
    expect(fixed).not.toBeNull();
    expect(fixed!.code[12]).toBe(ean13CheckDigit(fixed!.code.slice(0, 12)));
  });
  it('rejects non-numeric garbage', () => {
    expect(ean13Bits('ABC')).toBeNull();
    expect(ean13Bits('')).toBeNull();
  });
});

describe('barcode bit encodings (from the docs template spec)', () => {
  it('EAN-13 is exactly 95 modules wide with guards', () => {
    const enc = ean13Bits(ean13FromSku('BRK-00452'))!;
    expect(enc.bits).toHaveLength(95);
    expect(enc.bits.startsWith('101')).toBe(true);
    expect(enc.bits.slice(45, 50)).toBe('01010'); // middle guard
    expect(enc.bits.endsWith('101')).toBe(true);
  });
  it('Code 128 (mode B) is 11*(1+9+1)+13 = 134 modules for a 9-char payload', () => {
    // 'BRK-00452' → start + 9 chars + checksum + stop(13)
    const enc = code128Bits('BRK-00452');
    expect(enc.bits).toHaveLength(134);
    expect(enc.code).toBe('BRK-00452');
  });
  it('SVG uses crispEdges and draws bars as rects', () => {
    const svg = barcodeSVG('101', 26);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('<rect x="0" y="0" width="1" height="26" />');
  });
});

describe('renderLabelHTML', () => {
  it('contains every label part from the docs spec', () => {
    const html = renderLabelHTML(base);
    expect(html).toContain('فروشگاه سلیم‌وند');
    expect(html).toContain('lb-h-url');
    expect(html).toContain('>salimvand.ir<');
    expect(html).toContain('لنت ترمز جلو پژو ۲۰۶');
    expect(html).toContain('BRK-00452');
    expect(html).toContain('کد کالا');
    expect(html).toContain('ترمز');
    expect(html).toContain('اصالت و گارانتی کالا');
    expect((html.match(/<rect /g) ?? []).length).toBeGreaterThan(25);
  });
  it('escapes HTML in product fields (real inventory data)', () => {
    const html = renderLabelHTML({ ...base, name: '<script>x</script>', cars: 'a"b' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('a"b');
  });
  it('hides SKU/meta/footer rows when toggled off', () => {
    const html = renderLabelHTML({
      ...base,
      showSku: false,
      showMeta: false,
      showFoot: false,
    });
    expect(html).not.toContain('کد کالا');
    expect(html).not.toContain('lb-chip');
    expect(html).not.toContain('اصالت و گارانتی');
  });
  it('falls back to an invalid-barcode note instead of an empty svg', () => {
    const html = renderLabelHTML({ ...base, code: 'ABC', type: 'ean13' });
    expect(html).toContain('شمارهٔ بارکد نامعتبر');
    expect(html).not.toContain('<svg');
  });
  it('renders the site logo when provided and the «س» mark otherwise', () => {
    const withLogo = renderLabelHTML({ ...base, logoUrl: '/uploads/site/logo.webp' });
    expect(withLogo).toContain('src="/uploads/site/logo.webp"');
    expect(withLogo).not.toContain('class="mk"');
    const withoutLogo = renderLabelHTML(base);
    expect(withoutLogo).toContain('<div class="mk">س</div>');
    expect(withoutLogo).not.toContain('lb-logo');
  });
  it('uses the store name from settings when provided', () => {
    const html = renderLabelHTML({ ...base, storeName: 'فروشگاه علی' });
    expect(html).toContain('فروشگاه علی');
    expect(html).not.toContain('فروشگاه سلیم‌وند');
  });
  it('keeps the barcode bars inside their fixed-height box (no overlap)', () => {
    // `height:auto` made the SVG overflow its mm-sized wrapper onto the
    // digits and footer — the exact bug reported from the panel.
    expect(LABEL_CSS).toMatch(/\.lb-bc svg\{[^}]*height:100%/);
    expect(LABEL_CSS).not.toMatch(/\.lb-bc svg\{[^}]*height:auto/);
  });
  it('applies size, style and code128 classes', () => {
    const html = renderLabelHTML({ ...base, size: '60x40', style: 'mono', type: 'code128' });
    expect(html).toContain('lb s-60x40 mono');
    // code128 digits show the raw code text
    expect(html).toContain('6261234567890');
  });
});

describe('buildSheetHTML', () => {
  it('tiles the requested count on an A4 sheet with embedded font', () => {
    const doc = buildSheetHTML(Array.from({ length: 24 }, () => renderLabelHTML(base)));
    expect((doc.match(/class="lb /g) ?? []).length).toBe(24);
    expect(doc).toContain('@page{size:A4;margin:8mm}');
    expect(doc).toContain('gap:2mm');
    expect(doc).toContain("@font-face{font-family:'Vazirmatn'");
    expect(doc).toContain('woff2');
  });
});

const shelf: ShelfLabelOptions = {
  name: 'قفسه جلو',
  code: 'A-03',
  warehouse: 'انبار اصلی',
  size: '50x30',
  style: 'brand',
  showBarcode: true,
};

describe('renderShelfLabelHTML (برچسب قفسه‌ها)', () => {
  it('puts the shelf name, warehouse chip and code on the label', () => {
    const html = renderShelfLabelHTML(shelf);
    expect(html).toContain('قفسه جلو');
    expect(html).toContain('انبار اصلی');
    expect(html).toContain('>A-03<');
    expect(html).toContain('sl-name');
    expect(html).toContain('فروشگاه سلیم‌وند');
    expect(html).toContain('>salimvand.ir<');
  });
  it('encodes the code as Code 128 (uppercase) with the same SVG engine', () => {
    const html = renderShelfLabelHTML(shelf);
    expect(html).toContain(barcodeSVG(code128Bits('A-03').bits, 26));
    expect(html).toContain('lb-digits');
  });
  it('uppercases lowercase shelf codes before encoding', () => {
    const html = renderShelfLabelHTML({ ...shelf, code: 'a-03' });
    // barcode block carries the normalized code; the visible text keeps the original
    expect(html).toContain(barcodeSVG(code128Bits('A-03').bits, 26));
    expect(html).toContain('>a-03<');
  });
  it('drops the barcode block when the toggle is off', () => {
    const html = renderShelfLabelHTML({ ...shelf, showBarcode: false });
    expect(html).not.toContain('lb-bc');
    expect(html).not.toContain('<svg');
  });
  it('omits the warehouse chip for legacy shelves without a warehouse', () => {
    const html = renderShelfLabelHTML({ ...shelf, warehouse: '' });
    expect(html).not.toContain('lb-chip');
    expect(html).toContain('>A-03<');
  });
  it('escapes operator-entered shelf data', () => {
    const html = renderShelfLabelHTML({ ...shelf, name: '<script>قفسه</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;قفسه&lt;/script&gt;');
  });
  it('applies size and style classes like product labels', () => {
    const html = renderShelfLabelHTML({ ...shelf, size: '60x40', style: 'mono' });
    expect(html).toContain('lb s-60x40 mono');
  });
  it('ships shelf-label CSS in the single-source stylesheet', () => {
    // The print sheet and the live preview share LABEL_CSS; the shelf block
    // must be there or the printed shelf label loses all of its styling.
    expect(LABEL_CSS).toContain('.sl-name');
    expect(LABEL_CSS).toContain('.sl-code');
    expect(LABEL_CSS).toContain('.lb.s-38x22 .sl-name');
  });
  it('tiles one shelf label per shelf on the same A4 sheet builder', () => {
    const rows = [
      { ...shelf, name: 'قفسه جلو', code: 'A-01' },
      { ...shelf, name: 'قفسه عقب', code: 'A-02' },
      { ...shelf, name: 'باکس ابزار', code: 'BX-1', warehouse: '' },
    ];
    const doc = buildSheetHTML(rows.map((row) => renderShelfLabelHTML(row)));
    expect((doc.match(/class="lb /g) ?? []).length).toBe(3);
    expect(doc).toContain('قفسه عقب');
    expect(doc).toContain('BX-1');
  });
});
