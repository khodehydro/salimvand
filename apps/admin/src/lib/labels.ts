/**
 * موتور «برچسب محصول» — پورت مستقیم از قالب رسمی داکیومنت
 * (salimvand-docs / more features / label_template.html).
 *
 * همه‌چیز pure است: ورودی‌های برچسب → HTML رشته‌ای. همان HTML هم در
 * پیش‌نمایش زندهٔ پنل استفاده می‌شود و هم در برگهٔ چاپ A4 (iframe چاپ)، پس
 * آنچه می‌بینید دقیقاً همان چیزی است که چاپ می‌شود. اندازه‌ها با واحد mm
 * تعریف شده‌اند و خروجی چاپ در مقیاس واقعی است.
 */

/** @license مختصر: جداول کدگذاری EAN-13 و Code 128 از قالب داکیومنت پروژه. */

import vazirmatnBold from 'vazirmatn/fonts/webfonts/Vazirmatn-Bold.woff2?url';
import vazirmatnRegular from 'vazirmatn/fonts/webfonts/Vazirmatn-Regular.woff2?url';

export const STORE_NAME = 'فروشگاه سلیم‌وند';
export const STORE_SITE = 'salimvand.ir';

export type LabelSize = '50x30' | '60x40' | '40x60' | '38x22';
export type LabelStyle = 'brand' | 'mono' | 'navy';
export type BarcodeType = 'ean13' | 'code128';

export const labelSizes: Array<{ id: LabelSize; label: string; hint: string }> = [
  { id: '50x30', label: '۵۰×۳۰', hint: 'پیش‌فرض — رول لیبل استاندارد قطعات' },
  { id: '60x40', label: '۶۰×۴۰', hint: 'کارتن و قطعات بزرگ (باتری، رادیاتور)' },
  { id: '40x60', label: '۴۰×۶۰', hint: 'پیش‌فرض عمودی — مناسب لیبل قطعات' },
  { id: '38x22', label: '۳۸×۲۲', hint: 'قطعات کوچک (شمع، فیلتر، سنسور)' },
];

export const labelStyles: Array<{ id: LabelStyle; label: string }> = [
  { id: 'brand', label: 'برند (رنگی)' },
  { id: 'mono', label: 'تک‌رنگ' },
  { id: 'navy', label: 'ناوی' },
];

export const barcodeTypes: Array<{ id: BarcodeType; label: string }> = [
  { id: 'ean13', label: 'EAN-13' },
  { id: 'code128', label: 'Code 128' },
];

/* ============ فرار HTML (دادهٔ واقعی انبار وارد برچسب می‌شود) ============ */
const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ============ تولید شمارهٔ بارکد از SKU (مثل قالب داکیومنت) ============ */
/** پیشوند ۶۲۶ = کد کشوری ایران در GS1؛ از روی SKU به‌صورت پایدار ساخته می‌شود. */
export function ean13FromSku(sku: string): string {
  let h = 0;
  for (const ch of sku) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  const body = ('626' + String(h).padStart(9, '0')).slice(0, 12);
  return body + ean13CheckDigit(body);
}

export function ean13CheckDigit(b12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += +b12[i]! * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

/* ============ کدگذاری EAN-13 ============ */
const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const EAN_P = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

export function ean13Bits(code: string): { bits: string; code: string } | null {
  let digits = code.replace(/\D/g, '');
  if (digits.length === 12) digits += ean13CheckDigit(digits);
  if (digits.length !== 13) return null;
  if (digits[12] !== ean13CheckDigit(digits.slice(0, 12)))
    digits = digits.slice(0, 12) + ean13CheckDigit(digits.slice(0, 12));
  const pattern = EAN_P[+digits[0]!]!;
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (pattern[i - 1] === 'L' ? EAN_L : EAN_G)[+digits[i]!]!;
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += EAN_R[+digits[i]!]!;
  bits += '101';
  return { bits, code: digits };
}

/* ============ کدگذاری Code 128 (حالت B) ============ */
const C128 = [
  '11011001100',
  '11001101100',
  '11001100110',
  '10010011000',
  '10010001100',
  '10001001100',
  '10011001000',
  '10011000100',
  '10001100100',
  '11001001000',
  '11001000100',
  '11000100100',
  '10110011100',
  '10011011100',
  '10011001110',
  '10111001100',
  '10011101100',
  '10011100110',
  '11001110010',
  '11001011100',
  '11001001110',
  '11011100100',
  '11001110100',
  '11101101110',
  '11101001100',
  '11100101100',
  '11100100110',
  '11101100100',
  '11100110100',
  '11100110010',
  '11011011000',
  '11011000110',
  '11000110110',
  '10100011000',
  '10001011000',
  '10001000110',
  '10110001000',
  '10001101000',
  '10001100010',
  '11010001000',
  '11000101000',
  '11000100010',
  '10110111000',
  '10110001110',
  '10001101110',
  '10111011000',
  '10111000110',
  '10001110110',
  '11101110110',
  '11010001110',
  '11000101110',
  '11011101000',
  '11011100010',
  '11011101110',
  '11101011000',
  '11101000110',
  '11100010110',
  '11101101000',
  '11101100010',
  '11100011010',
  '11101111010',
  '11001000010',
  '11110001010',
  '10100110000',
  '10100001100',
  '10010110000',
  '10010000110',
  '10000101100',
  '10000100110',
  '10110010000',
  '10110000100',
  '10011010000',
  '10011000010',
  '10000110100',
  '10000110010',
  '11000010010',
  '11001010000',
  '11110111010',
  '11000010100',
  '10001111010',
  '10100111100',
  '10010111100',
  '10010011110',
  '10111100100',
  '10011110100',
  '10011110010',
  '11110100100',
  '11110010100',
  '11110010010',
  '11011011110',
  '11011110110',
  '11110110110',
  '10101111000',
  '10100011110',
  '10001011110',
  '10111101000',
  '10111100010',
  '11110101000',
  '11110100010',
  '10111011110',
  '10111101110',
  '11101011110',
  '11110101110',
  '11010000100',
  '11010010000',
  '11010011100',
  '11000111010',
];
const C128_STOP = '1100011101011';

export function code128Bits(text: string): { bits: string; code: string } {
  const codes = [104]; // Start B
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    codes.push(v >= 0 && v <= 94 ? v : 0);
  }
  let sum = 104;
  for (let i = 1; i < codes.length; i++) sum += codes[i]! * i;
  codes.push(sum % 103);
  return { bits: codes.map((c) => C128[c]).join('') + C128_STOP, code: text };
}

/* ============ رسم SVG بارکد (برداری، لبه‌های تیز برای چاپ) ============ */
export function barcodeSVG(bits: string, h: number): string {
  const n = bits.length;
  const parts: string[] = [];
  let i = 0;
  while (i < n) {
    if (bits[i] === '1') {
      let j = i;
      while (j < n && bits[j] === '1') j++;
      parts.push(`<rect x="${i}" y="0" width="${j - i}" height="${h}" />`);
      i = j;
    } else i++;
  }
  return `<svg viewBox="0 0 ${n} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="barcode"><g fill="currentColor">${parts.join('')}</g></svg>`;
}

/* ============ ساخت یک برچسب (ساختار عین قالب داکیومنت) ============ */
export type LabelOptions = {
  name: string;
  sku: string;
  code: string;
  category: string;
  cars: string;
  size: LabelSize;
  style: LabelStyle;
  type: BarcodeType;
  showSku: boolean;
  showMeta: boolean;
  showFoot: boolean;
  /** Store name from settings (falls back to فروشگاه سلیم‌وند). */
  storeName?: string;
  footerText?: string;
  /** Site logo path from settings (e.g. /uploads/site/logo.webp); when
   * empty the «س» monogram mark is used instead. */
  logoUrl?: string;
};

export function renderLabelHTML(o: LabelOptions): string {
  const size = `s-${o.size}`;
  const sty = o.style === 'brand' ? '' : o.style;
  const enc =
    o.type === 'ean13'
      ? ean13Bits(o.code || '')
      : code128Bits((o.code || o.sku || '').toUpperCase());
  const bh = o.size === '60x40' || o.size === '40x60' ? 34 : o.size === '38x22' ? 20 : 26;
  const bars = enc
    ? barcodeSVG(enc.bits, bh)
    : '<div style="font-size:2mm;color:#c8383c">شمارهٔ بارکد نامعتبر</div>';
  const digits = enc
    ? o.type === 'ean13'
      ? enc.code.slice(0, 1) + ' ' + enc.code.slice(1, 7) + ' ' + enc.code.slice(7)
      : enc.code
    : '';
  const bcStyle = `height:${o.size === '60x40' || o.size === '40x60' ? '8mm' : o.size === '38x22' ? '4.6mm' : '5.4mm'}`;

  const metaRow = o.showMeta
    ? `
      <div class="lb-meta">
        <span class="lb-chip">${esc(o.category)}</span>
        <span class="dot"></span>
        <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(o.cars)}</span>
      </div>`
    : '';
  const skuRow = o.showSku
    ? `
      <div class="lb-meta" style="justify-content:space-between">
        <span style="font-weight:600">کد کالا</span>
        <span class="lb-sku">${esc(o.sku)}</span>
      </div>`
    : '';
  const foot =
    o.showFoot && o.size !== '38x22'
      ? `
      <div class="lb-foot">
        <span>${esc(o.footerText || 'اصالت و گارانتی کالا')}</span>
        <span class="lb-digits-latin">${STORE_SITE}</span>
      </div>`
      : '';

  const mark = o.logoUrl
    ? `<img class="lb-logo" src="${esc(o.logoUrl)}" alt="" />`
    : '<div class="mk">س</div>';
  return `
  <div class="lb ${size} ${sty}">
    <div class="lb-h">
      ${mark}
      <div class="nm">${esc(o.storeName || STORE_NAME)}</div>
      <div class="lb-digits-latin lb-h-url">${STORE_SITE}</div>
    </div>
    <div class="lb-b">
      <div class="lb-name">${esc(o.name)}</div>
      ${metaRow}
      ${skuRow}
      <div class="lb-bc">
        <div style="${bcStyle};width:100%;color:inherit">${bars}</div>
        <div class="lb-digits">${esc(digits)}</div>
      </div>
      ${foot}
    </div>
  </div>`;
}

/* ============ برچسب قفسه — نام قهرمان، کد خوانا و بارکد Code 128 ============ */

export type ShelfLabelOptions = {
  /** Display name of the shelf («قفسه جلو») — the hero of the label. */
  name: string;
  /** Shelf code («A-03») — shown large and encoded as Code 128. */
  code: string;
  /** Owning warehouse («انبار اصلی») — chip beside the code; '' when none. */
  warehouse: string;
  size: LabelSize;
  style: LabelStyle;
  /** Draw the Code 128 barcode of the code (shelf codes are free-form text,
   * so EAN-13 does not apply here). */
  showBarcode: boolean;
  /** Store name from settings (falls back to فروشگاه سلیم‌وند). */
  storeName?: string;
  logoUrl?: string;
};

export function renderShelfLabelHTML(o: ShelfLabelOptions): string {
  const sty = o.style === 'brand' ? '' : o.style;
  const enc = o.showBarcode && o.code.trim() ? code128Bits(o.code.trim().toUpperCase()) : null;
  const bh = o.size === '60x40' || o.size === '40x60' ? 34 : o.size === '38x22' ? 20 : 26;
  const bcStyle = `height:${o.size === '60x40' || o.size === '40x60' ? '8mm' : o.size === '38x22' ? '4.6mm' : '5.4mm'}`;
  const mark = o.logoUrl
    ? `<img class="lb-logo" src="${esc(o.logoUrl)}" alt="" />`
    : '<div class="mk">س</div>';
  const warehouseChip = o.warehouse.trim()
    ? `<span class="lb-chip">${esc(o.warehouse)}</span>`
    : '';
  const codeText = o.code.trim() ? `<span class="sl-code">${esc(o.code)}</span>` : '';
  return `
  <div class="lb s-${o.size} ${sty} sl">
    <div class="lb-h">
      ${mark}
      <div class="nm">${esc(o.storeName || STORE_NAME)}</div>
      <div class="lb-digits-latin lb-h-url">${STORE_SITE}</div>
    </div>
    <div class="sl-b">
      <div class="sl-name">${esc(o.name)}</div>
      ${
        warehouseChip || codeText
          ? `
      <div class="sl-sub">${warehouseChip}${codeText}</div>`
          : ''
      }
      ${
        enc
          ? `
      <div class="lb-bc">
        <div style="${bcStyle};width:100%;color:inherit">${barcodeSVG(enc.bits, bh)}</div>
        <div class="lb-digits">${esc(enc.code)}</div>
      </div>`
          : ''
      }
    </div>
  </div>`;
}

/* ============ CSS برچسب — تک‌منبع برای پیش‌نمایش و چاپ ============ */
export const LABEL_CSS = `
.lb{position:relative;background:#fff;color:#0b1c2f;overflow:hidden;
  border:.25mm solid #c8d4e3;border-radius:1.6mm;
  font-family:'Vazirmatn',Tahoma,sans-serif;
  display:flex;flex-direction:column;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.lb *{box-sizing:border-box}
.lb-h{background:#0d2b4b;color:#fff;display:flex;align-items:center;gap:1mm;flex:none;
  padding:0 1.6mm;position:relative}
.lb-h .mk{width:3.8mm;height:3.8mm;border-radius:1mm;background:#fff;color:#0d2b4b;
  display:grid;place-items:center;font-weight:700;line-height:1;flex:none}
.lb-h .lb-logo{width:3.8mm;height:3.8mm;border-radius:1mm;background:#fff;flex:none;
  object-fit:contain;padding:.25mm;display:block}
.lb-h .nm{font-weight:700;letter-spacing:.01em;white-space:nowrap}
.lb-h .lb-h-url{margin-inline-start:auto;color:#bcd7f5;font-weight:600;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.lb-h::after{content:"";position:absolute;inset-block:0;inset-inline-start:0;width:1.2mm;background:#3f8ede}
.lb-b{flex:1;display:flex;flex-direction:column;padding:1.4mm 1.8mm 1mm;gap:.5mm;min-height:0;overflow:hidden}
.lb-name{font-weight:700;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lb-meta{display:flex;align-items:center;gap:1.2mm;color:#4a5f79;line-height:1.5;min-height:0}
.lb-meta .dot{width:.7mm;height:.7mm;border-radius:50%;background:#bcd7f5;flex:none}
.lb-chip{background:#f1f6fd;border:.2mm solid #e0ecfa;color:#124270;border-radius:.9mm;
  padding:0 .9mm;font-weight:600;white-space:nowrap;line-height:1.7}
.lb-sku{direction:ltr;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;color:#0d2b4b;letter-spacing:.02em}
.lb-bc{margin-top:auto;flex:none;display:flex;flex-direction:column;align-items:center;gap:.2mm;
  background:#fff;padding-top:.4mm}
/* SVG fills the fixed-height bar wrapper exactly: height:auto would size
   it by the viewBox ratio (~12.6mm on a 50mm label) and the bars would
   overflow onto the digits and footer below. */
.lb-bc svg{display:block;width:100%;height:100%}
.lb-digits{direction:ltr;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:600;
  letter-spacing:.14em;color:#0b1c2f;line-height:1.25}
.lb-digits-latin{direction:ltr;font-family:ui-monospace,Menlo,Consolas,monospace}
.lb-foot{display:flex;align-items:center;justify-content:space-between;gap:1mm;color:#8095ad;
  border-top:.2mm dashed #dce4ee;margin-top:.6mm;padding-top:.5mm;line-height:1.5}

/* حالت تک‌رنگ (چاپگر حرارتی) */
.lb.mono{border-color:#000}
.lb.mono .lb-h{background:#000}
.lb.mono .lb-h::after{background:#fff}
.lb.mono .lb-h .mk{background:#fff;color:#000}
.lb.mono .lb-h .lb-h-url{color:#fff}
.lb.mono .lb-chip{background:#fff;border-color:#000;color:#000}
.lb.mono,.lb.mono .lb-name,.lb.mono .lb-sku,.lb.mono .lb-digits{color:#000}
.lb.mono .lb-meta,.lb.mono .lb-foot{color:#333}
.lb.mono .lb-foot{border-top-color:#666}
.lb.mono .lb-meta .dot{background:#666}

/* حالت ناوی تمام‌رنگ (برچسب پریمیوم) */
.lb.navy{background:#0d2b4b;border-color:#0a2440;color:#fff}
.lb.navy .lb-h{background:transparent;border-bottom:.2mm solid rgba(255,255,255,.16)}
.lb.navy .lb-h::after{background:#3f8ede}
.lb.navy .lb-name{color:#fff}
.lb.navy .lb-meta{color:#bcd7f5}
.lb.navy .lb-chip{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22);color:#e0ecfa}
.lb.navy .lb-sku{color:#fff}
.lb.navy .lb-bc{background:#fff;border-radius:1mm;padding:.6mm .8mm .3mm}
.lb.navy .lb-foot{color:#7fb5ea;border-top-color:rgba(255,255,255,.18)}

/* — اندازه‌ها — */
.lb.s-50x30{width:50mm;height:30mm;font-size:2.05mm}
.lb.s-50x30 .lb-h{height:5.6mm;font-size:2.1mm}
.lb.s-50x30 .lb-h .lb-h-url{font-size:1.8mm}
.lb.s-50x30 .lb-name{font-size:2.5mm}
.lb.s-50x30 .lb-meta{font-size:1.85mm}
.lb.s-50x30 .lb-digits{font-size:2.1mm}
.lb.s-50x30 .lb-foot{font-size:1.6mm}

.lb.s-60x40{width:60mm;height:40mm;font-size:2.3mm}
.lb.s-60x40 .lb-h{height:6.6mm;font-size:2.5mm}
.lb.s-60x40 .lb-h .mk{width:4.4mm;height:4.4mm}
.lb.s-60x40 .lb-h .lb-logo{width:4.4mm;height:4.4mm}
.lb.s-60x40 .lb-h .lb-h-url{font-size:2mm}
.lb.s-60x40 .lb-b{padding:1.8mm 2.2mm 1.2mm}
.lb.s-60x40 .lb-name{font-size:3mm}
.lb.s-60x40 .lb-meta{font-size:2.1mm}
.lb.s-60x40 .lb-digits{font-size:2.4mm}
.lb.s-60x40 .lb-foot{font-size:1.9mm}

.lb.s-38x22{width:38mm;height:22mm;font-size:1.7mm}
.lb.s-38x22 .lb-h{height:4.2mm;font-size:1.75mm;padding:0 1.1mm}
.lb.s-38x22 .lb-h .mk{width:2.9mm;height:2.9mm;border-radius:.7mm}
.lb.s-38x22 .lb-h .lb-logo{width:2.9mm;height:2.9mm;border-radius:.7mm;padding:.2mm}
.lb.s-38x22 .lb-h .lb-h-url{font-size:1.45mm}
.lb.s-38x22 .lb-b{padding:.9mm 1.2mm .7mm;gap:.3mm}
.lb.s-38x22 .lb-name{font-size:1.95mm;-webkit-line-clamp:1}
.lb.s-38x22 .lb-meta{font-size:1.5mm}
.lb.s-38x22 .lb-digits{font-size:1.7mm;letter-spacing:.1em}
.lb.s-38x22 .lb-foot{display:none}

/* — برچسب قفسه: نام بزرگ، کد خوانا، بارکد پایین — */
.sl-b{flex:1;display:flex;flex-direction:column;justify-content:center;gap:.7mm;
  padding:1.4mm 1.8mm 1.2mm;min-height:0;overflow:hidden}
.sl-name{font-weight:800;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden}
.sl-sub{display:flex;align-items:center;gap:1.2mm;color:#4a5f79;min-height:0;
  flex-wrap:nowrap;overflow:hidden}
.sl-code{direction:ltr;font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;
  color:#0d2b4b;letter-spacing:.05em;white-space:nowrap}
.lb.mono .sl-name{color:#000}
.lb.mono .sl-sub{color:#333}
.lb.mono .sl-code{color:#000}
.lb.navy .sl-name{color:#fff}
.lb.navy .sl-sub{color:#bcd7f5}
.lb.navy .sl-code{color:#e0ecfa}

.lb.s-50x30 .sl-name{font-size:3.3mm}
.lb.s-50x30 .sl-code{font-size:2.7mm}
.lb.s-50x30 .sl-sub{font-size:1.9mm}
.lb.s-60x40 .sl-name{font-size:4.2mm}
.lb.s-60x40 .sl-code{font-size:3.4mm}
.lb.s-60x40 .sl-sub{font-size:2.2mm}
.lb.s-40x60 .sl-name{font-size:3.6mm}
.lb.s-40x60 .sl-code{font-size:2.9mm}
.lb.s-40x60 .sl-sub{font-size:2mm}
.lb.s-38x22 .sl-name{font-size:2.7mm;-webkit-line-clamp:1}
.lb.s-38x22 .sl-code{font-size:2.3mm}
.lb.s-38x22 .sl-sub{font-size:1.5mm}
`;

/** برگهٔ چاپ A4: سند کامل و مستقل برای iframe چاپ (فونت وزیرمتن جاسازی‌شده). */
export function buildSheetHTML(labels: string[]): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<style>
@font-face{font-family:'Vazirmatn';src:url(${vazirmatnRegular}) format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Vazirmatn';src:url(${vazirmatnBold}) format('woff2');font-weight:700;font-style:normal;font-display:block}
@page{size:A4;margin:8mm}
html,body{margin:0;padding:0;background:#fff}
body{display:flex;flex-wrap:wrap;align-content:flex-start;gap:2mm;
  font-family:'Vazirmatn',Tahoma,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lb{break-inside:avoid;page-break-inside:avoid}
${LABEL_CSS}
</style>
</head>
<body>${labels.join('')}</body>
<script>
window.addEventListener('load', function () {
  var go = function () { setTimeout(function () { window.focus(); window.print(); }, 60); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
});
</script>
</html>`;
}

/** متن راهنمای زیر پیش‌نمایش. */
export const persianDigits = (value: string | number) =>
  String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]!);
