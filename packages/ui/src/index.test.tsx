import { describe, expect, it } from 'vitest';
import { designTokens, uiCss } from './index';

describe('design system contract', () => {
  it('keeps light and dark palettes complete', () => {
    const keys = ['bg', 'surface', 'surface2', 'surface3', 'border', 'text', 'text2', 'text3', 'primary', 'link', 'ok', 'warn', 'danger'] as const;
    for (const key of keys) {
      expect(designTokens.light[key]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(designTokens.dark[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('publishes accessible theme and interaction rules', () => {
    expect(uiCss).toContain('[data-theme=light]');
    expect(uiCss).toContain('[data-theme=dark]');
    expect(uiCss).toContain(':focus-visible');
    expect(uiCss).toContain(':disabled');
    expect(uiCss).toContain('prefers-reduced-motion');
  });
});
