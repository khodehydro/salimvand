// Untyped runtime dependencies used by the PDF renderer.
declare module 'arabic-persian-reshaper' {
  /** Converts Arabic/Persian letters to their contextual presentation forms. */
  export const PersianShaper: { convertArabic(text: string): string };
  export const ArabicShaper: { convertArabic(text: string): string };
}

declare module 'bidi-js' {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  interface Bidi {
    getEmbeddingLevels(text: string, baseDirection: 'ltr' | 'rtl'): EmbeddingLevels;
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string;
    getReorderedIndices(text: string, embeddingLevels: EmbeddingLevels): number[];
  }
  function bidiFactory(): Bidi;
  export = bidiFactory;
}
