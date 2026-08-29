/**
 * Design tokens — single source of truth for the Salim Vand visual contract.
 * Source: docs/delivery-spec.md ("توکن‌های طراحی"). Components must consume
 * `var(--sv-*)` only; raw hex values inside components are forbidden.
 */

export const brand = {
  950: '#04121f',
  900: '#071c30',
  850: '#0a2440',
  800: '#0d2b4b',
  700: '#124270',
  600: '#175894',
  500: '#1f6fbe',
  400: '#3f8ede',
  300: '#7fb5ea',
  200: '#bcd7f5',
  100: '#e0ecfa',
  50: '#f1f6fd',
} as const;

export type SemanticTokens = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  border2: string;
  text: string;
  text2: string;
  text3: string;
  primary: string;
  primaryHover: string;
  primaryFg: string;
  link: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  sidebar: string;
  /** Text/icon colour that sits on navy or primary surfaces (constant in both skins). */
  onBrand: string;
  onNavy: string;
  /** Translucent overlays + shadow tints, derived from brand-950 so they stay on-palette. */
  overlay: string;
  scrim: string;
  shadowColor: string;
  shadowSoft: string;
};

export const lightTokens: SemanticTokens = {
  bg: '#f3f6fa',
  surface: '#ffffff',
  surface2: '#f7fafd',
  surface3: '#eef3f9',
  border: '#dce4ee',
  border2: '#c8d4e3',
  text: '#0b1c2f',
  text2: '#4a5f79',
  text3: '#8095ad',
  primary: '#0d2b4b',
  primaryHover: '#0a2440',
  primaryFg: '#ffffff',
  link: '#175894',
  ok: '#0f8f52',
  okSoft: '#e3f5ea',
  warn: '#b9770b',
  warnSoft: '#fdf0d9',
  danger: '#c8383c',
  dangerSoft: '#fbe7e8',
  sidebar: brand[900],
  onBrand: '#ffffff',
  onNavy: '#eaf1f9',
  overlay: '#ffffff21',
  scrim: '#04121f8c',
  shadowColor: '#04121f55',
  shadowSoft: '#04121f21',
};

export const darkTokens: SemanticTokens = {
  bg: '#050b14',
  surface: '#0d1826',
  surface2: '#111f31',
  surface3: '#16283c',
  border: '#1d3049',
  border2: '#294061',
  text: '#eaf1f9',
  text2: '#9db1c8',
  text3: '#6c8299',
  primary: '#2f7fce',
  primaryHover: '#4d99e0',
  primaryFg: '#04101c',
  link: '#69a8e6',
  ok: '#3ecf8e',
  okSoft: '#0d2f24',
  warn: '#f0b454',
  warnSoft: '#332509',
  danger: '#ff7a7f',
  dangerSoft: '#3a1618',
  sidebar: brand[900],
  onBrand: '#ffffff',
  onNavy: '#eaf1f9',
  overlay: '#ffffff21',
  scrim: '#04121f8c',
  shadowColor: '#04121f55',
  shadowSoft: '#04121f21',
};

export const geometry = {
  radiusButton: 10,
  radiusCard: 14,
  radiusPill: 999,
  radiusModal: 18,
} as const;

export const spacing = [4, 8, 12, 16, 24, 32, 48] as const;

export const shadows = {
  level1: '0 1px 2px rgba(4, 18, 31, 0.06), 0 1px 3px rgba(4, 18, 31, 0.08)',
  level2: '0 6px 18px rgba(4, 18, 31, 0.10), 0 2px 6px rgba(4, 18, 31, 0.06)',
  modal: '0 24px 60px rgba(4, 18, 31, 0.32), 0 8px 24px rgba(4, 18, 31, 0.18)',
} as const;

export const typography = {
  family: "'Vazirmatn', Tahoma, Arial, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  weights: [400, 500, 600, 700] as const,
};

/** Ordered brand ramp used by recharts (donut / bar) so charts stay on-palette. */
export const chartColors = [
  brand[600],
  brand[400],
  brand[800],
  brand[300],
  brand[900],
  brand[200],
] as const;

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

export type Theme = 'light' | 'dark';

const cssVarNames: Record<keyof SemanticTokens, string> = {
  bg: '--sv-bg',
  surface: '--sv-surface',
  surface2: '--sv-surface-2',
  surface3: '--sv-surface-3',
  border: '--sv-border',
  border2: '--sv-border-2',
  text: '--sv-text',
  text2: '--sv-text-2',
  text3: '--sv-text-3',
  primary: '--sv-primary',
  primaryHover: '--sv-primary-hover',
  primaryFg: '--sv-primary-fg',
  link: '--sv-link',
  ok: '--sv-ok',
  okSoft: '--sv-ok-soft',
  warn: '--sv-warn',
  warnSoft: '--sv-warn-soft',
  danger: '--sv-danger',
  dangerSoft: '--sv-danger-soft',
  sidebar: '--sv-sidebar',
  onBrand: '--sv-on-brand',
  onNavy: '--sv-on-navy',
  overlay: '--sv-overlay',
  scrim: '--sv-scrim',
  shadowColor: '--sv-shadow-color',
  shadowSoft: '--sv-shadow-soft',
};

export const tokenCssVarNames = cssVarNames;

export function toCssVariables(tokens: SemanticTokens): Record<string, string> {
  const brandVars = Object.entries(brand).reduce<Record<string, string>>(
    (accumulator, [step, value]) => {
      accumulator[`--sv-brand-${step}`] = value;
      return accumulator;
    },
    {},
  );
  const semanticVars = (Object.keys(cssVarNames) as Array<keyof SemanticTokens>).reduce<
    Record<string, string>
  >((accumulator, key) => {
    accumulator[cssVarNames[key]] = tokens[key];
    return accumulator;
  }, {});
  return {
    ...brandVars,
    ...semanticVars,
    '--sv-radius-button': `${geometry.radiusButton}px`,
    '--sv-radius-card': `${geometry.radiusCard}px`,
    '--sv-radius-pill': `${geometry.radiusPill}px`,
    '--sv-radius-modal': `${geometry.radiusModal}px`,
    '--sv-shadow-1': shadows.level1,
    '--sv-shadow-2': shadows.level2,
    '--sv-shadow-modal': shadows.modal,
    '--sv-font': typography.family,
    '--sv-font-mono': typography.mono,
    ...spacing.reduce<Record<string, string>>((accumulator, value, index) => {
      accumulator[`--sv-space-${index + 1}`] = `${value}px`;
      return accumulator;
    }, {}),
  };
}

function renderBlock(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  return `${selector}{${body}}`;
}

/**
 * Theme variables for both skins. Injected by `ThemeProvider` (SSR-safe) and
 * mirrored in `styles.css` so a plain stylesheet import is enough for apps.
 */
export const themeCss = `${renderBlock(':root,[data-theme=light]', toCssVariables(lightTokens))}
${renderBlock('[data-theme=dark]', toCssVariables(darkTokens))}`;

/** Availability → semantic tone mapping required by the delivery spec. */
export function availabilityTone(availability: string): Tone {
  switch (availability) {
    case 'in_stock':
      return 'ok';
    case 'low_stock':
    case 'coming_soon':
      return 'warn';
    case 'out_of_stock':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const availabilityLabels: Record<string, string> = {
  in_stock: 'موجود',
  low_stock: 'موجود (کم)',
  coming_soon: 'به‌زودی',
  out_of_stock: 'ناموجود',
  discontinued: 'توقف تولید',
};

/** Backwards-compatible alias kept for earlier imports of `designTokens`. */
export const designTokens = {
  brand,
  light: lightTokens,
  dark: darkTokens,
  geometry,
  spacing,
  shadows,
  typography,
} as const;
