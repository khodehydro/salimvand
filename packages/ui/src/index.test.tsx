import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AvailabilityBadge,
  Button,
  Code,
  DataTable,
  DesignSystemPreview,
  KpiCard,
  Num,
  StockBar,
  availabilityTone,
  brand,
  darkTokens,
  designSystemCss,
  geometry,
  lightTokens,
  spacing,
  themeCss,
  toCssVariables,
  typography,
} from './index';

describe('design tokens', () => {
  it('keeps light and dark palettes key-for-key complete', () => {
    const keys = Object.keys(lightTokens) as Array<keyof typeof lightTokens>;
    expect(keys.length).toBeGreaterThanOrEqual(26);
    for (const key of keys) {
      expect(lightTokens[key]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      expect(darkTokens[key]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
    }
    expect(Object.keys(darkTokens)).toEqual(keys);
  });

  it('matches the delivery-spec palette and geometry', () => {
    expect(brand[800]).toBe('#0d2b4b');
    expect(brand[950]).toBe('#04121f');
    expect(lightTokens.primary).toBe('#0d2b4b');
    expect(lightTokens.primaryHover).toBe('#0a2440');
    expect(darkTokens.primary).toBe('#2f7fce');
    expect(darkTokens.primaryFg).toBe('#04101c');
    expect(lightTokens.okSoft).toBe('#e3f5ea');
    expect(darkTokens.dangerSoft).toBe('#3a1618');
    expect(geometry.radiusButton).toBe(10);
    expect(geometry.radiusCard).toBe(14);
    expect(geometry.radiusPill).toBe(999);
    expect([...spacing]).toEqual([4, 8, 12, 16, 24, 32, 48]);
    expect(typography.weights).toContain(700);
    // Panel sidebar stays navy (brand-900) in both skins.
    expect(lightTokens.sidebar).toBe(brand[900]);
    expect(darkTokens.sidebar).toBe(brand[900]);
  });

  it('publishes CSS variables for both themes', () => {
    const vars = toCssVariables(lightTokens);
    expect(vars['--sv-brand-600']).toBe('#175894');
    expect(vars['--sv-primary']).toBe('#0d2b4b');
    expect(vars['--sv-radius-button']).toBe('10px');
    expect(vars['--sv-space-7']).toBe('48px');
    expect(themeCss).toContain('[data-theme=light]');
    expect(themeCss).toContain('[data-theme=dark]');
    expect(themeCss).toContain('--sv-sidebar:#071c30');
  });

  it('keeps component CSS token-only (no raw hex outside the token blocks)', () => {
    const withoutTokenBlocks = designSystemCss.split('@layer sv-components{')[1] ?? '';
    expect(withoutTokenBlocks).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(designSystemCss).toContain(':focus-visible');
    expect(designSystemCss).toContain(':disabled');
    expect(designSystemCss).toContain('prefers-reduced-motion');
  });
});

describe('status mapping', () => {
  it('maps availability to the semantic tones required by the spec', () => {
    expect(availabilityTone('in_stock')).toBe('ok');
    expect(availabilityTone('low_stock')).toBe('warn');
    expect(availabilityTone('coming_soon')).toBe('warn');
    expect(availabilityTone('out_of_stock')).toBe('danger');
    expect(availabilityTone('discontinued')).toBe('neutral');
  });
});

describe('components', () => {
  it('renders buttons, badges and numeric/code formatting', () => {
    const markup = renderToStaticMarkup(
      <>
        <Button variant="danger" size="sm">
          ابطال
        </Button>
        <AvailabilityBadge availability="low_stock" />
        <Num value={12480} />
        <Code value="BRK-00452" />
        <StockBar value={2} min={5} />
        <KpiCard label="فروش امروز" value="۴۸٬۶۲۰" tone="ok" />
        <DataTable
          rows={[{ id: '1', name: 'لنت' }]}
          rowKey={(row) => row.id}
          columns={[{ key: 'name', header: 'کالا' }]}
          empty="خالی"
        />
      </>,
    );
    expect(markup).toContain('sv-btn--danger');
    expect(markup).toContain('sv-btn--sm');
    expect(markup).toContain('sv-badge--warn');
    expect(markup).toContain('موجود (کم)');
    expect(markup).toContain('۱۲۴۸۰');
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain('sv-stockbar is-warn');
    expect(markup).toContain('sv-kpi--ok');
    expect(markup).toContain('لنت');
  });

  it('renders the token gallery in both skins (phase 0 acceptance)', () => {
    const light = renderToStaticMarkup(<DesignSystemPreview theme="light" />);
    const dark = renderToStaticMarkup(<DesignSystemPreview theme="dark" />);
    expect(light).toContain('data-theme="light"');
    expect(dark).toContain('data-theme="dark"');
    expect(light).toContain('dir="rtl"');
    expect(dark).toContain('dir="rtl"');
    expect(light).toContain('sv-btn--primary');
    expect(dark).toContain('sv-btn--primary');
    expect(light).toContain('سیستم طراحی سلیم‌وند');
  });
});
