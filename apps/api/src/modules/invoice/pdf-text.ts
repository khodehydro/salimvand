import { PersianShaper } from 'arabic-persian-reshaper';
// CJS import form: this codebase compiles without esModuleInterop, and
// bidi-js's UMD build assigns module.exports = bidiFactory directly.
import bidiFactory = require('bidi-js');

const bidi = bidiFactory();

/**
 * Makes Persian text renderable by PDFKit.
 *
 * PDFKit has no shaping engine: it draws codepoints left-to-right, so raw
 * Persian would come out disconnected and in reverse order (the "garbled
 * English words" PDFs). Two steps fix it:
 *  1. PersianShaper maps every letter to its contextual presentation form
 *     (initial/medial/final/isolated — U+FExx), which the bundled Vazirmatn
 *     font includes;
 *  2. bidi-js applies the Unicode bidi algorithm with a base RTL direction,
 *     so embedded Latin/number runs (INV-000123, 100000) stay readable.
 */
export function faText(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw.trim()) return raw;
  const reshaped = PersianShaper.convertArabic(raw);
  const levels = bidi.getEmbeddingLevels(reshaped, 'rtl');
  return bidi.getReorderedString(reshaped, levels);
}

/**
 * Phone numbers may carry hyphens (۰۴۱-۱۲۳۴۵۶۷). Between two Persian-digit
 * groups a hyphen resolves RTL in the bidi pass, so the groups swap visually
 * (۱۲۳۴۵۶۷-۰۴۱). Wrapping the value in LRM marks (U+200E — a zero-width glyph
 * in Vazirmatn) keeps it a single LTR run that reads exactly as typed.
 */
export function ltrNumber(value: string): string {
  return `\u200E${value}\u200E`;
}
