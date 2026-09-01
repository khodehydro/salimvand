import { PersianShaper } from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';

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
