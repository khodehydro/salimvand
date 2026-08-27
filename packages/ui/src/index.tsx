import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { APP_NAME } from '@salimvand/shared';

/** Single source of truth for the visual contract. Components consume CSS vars, never raw colours. */
export const designTokens = {
  brand: { 950: '#04121f', 900: '#071c30', 850: '#0a2440', 800: '#0d2b4b', 700: '#124270', 600: '#175894', 500: '#1f6fbe', 400: '#3f8ede', 300: '#7fb5ea', 200: '#bcd7f5', 100: '#e0ecfa', 50: '#f1f6fd' },
  light: { bg: '#f3f6fa', surface: '#ffffff', surface2: '#f7fafd', surface3: '#eef3f9', border: '#dce4ee', text: '#0b1c2f', text2: '#4a5f79', text3: '#8095ad', primary: '#0d2b4b', link: '#175894', ok: '#0f8f52', warn: '#b9770b', danger: '#c8383c' },
  dark: { bg: '#050b14', surface: '#0d1826', surface2: '#111f31', surface3: '#16283c', border: '#1d3049', text: '#eaf1f9', text2: '#9db1c8', text3: '#6c8299', primary: '#2f7fce', link: '#69a8e6', ok: '#3ecf8e', warn: '#f0b454', danger: '#ff7a7f' },
} as const;

export type Theme = 'light' | 'dark';
export function ThemeProvider({ theme, children }: PropsWithChildren<{ theme: Theme }>) {
  return <div dir="rtl" data-theme={theme} className="sv-theme">{children}</div>;
}
export function BrandButton({ children, variant = 'primary', size = 'md', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'soft' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }>) {
  return <button {...props} className={`sv-btn sv-btn-${variant} sv-btn-${size} ${props.className ?? ''}`} data-brand={APP_NAME}>{children}</button>;
}
export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'ok' | 'warn' | 'danger' }>) { return <span className={`sv-badge sv-badge-${tone}`}>{children}</span>; }
export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) { return <section className={`sv-card ${className}`}>{children}</section>; }
export function Field({ label, children, hint }: PropsWithChildren<{ label: string; hint?: string; children: ReactNode }>) { return <label className="sv-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`sv-input ${props.className ?? ''}`} />; }

export const uiCss = `
.sv-theme{font-family:Vazirmatn,Tahoma,sans-serif;color:var(--sv-text);background:var(--sv-bg)}
.sv-theme[data-theme=light]{--sv-bg:#f3f6fa;--sv-surface:#fff;--sv-border:#dce4ee;--sv-text:#0b1c2f;--sv-text-2:#4a5f79;--sv-primary:#0d2b4b;--sv-link:#175894;--sv-ok:#0f8f52;--sv-warn:#b9770b;--sv-danger:#c8383c}
.sv-theme[data-theme=dark]{--sv-bg:#050b14;--sv-surface:#0d1826;--sv-border:#1d3049;--sv-text:#eaf1f9;--sv-text-2:#9db1c8;--sv-primary:#2f7fce;--sv-link:#69a8e6;--sv-ok:#3ecf8e;--sv-warn:#f0b454;--sv-danger:#ff7a7f}
.sv-btn{border:1px solid transparent;border-radius:10px;font:inherit;cursor:pointer;padding:9px 16px;transition:.15s}.sv-btn-sm{padding:6px 10px;font-size:12px}.sv-btn-lg{padding:12px 22px}.sv-btn-primary{background:var(--sv-primary);color:#fff}.sv-btn-outline{background:transparent;color:var(--sv-text);border-color:var(--sv-border)}.sv-btn-soft{background:color-mix(in srgb,var(--sv-link) 12%,transparent);color:var(--sv-link)}.sv-btn-ghost{background:transparent;color:var(--sv-text-2)}.sv-btn-danger{background:var(--sv-danger);color:#fff}.sv-badge{display:inline-flex;border-radius:999px;padding:3px 9px;font-size:12px}.sv-badge-neutral{background:var(--sv-border);color:var(--sv-text-2)}.sv-badge-ok{background:color-mix(in srgb,var(--sv-ok) 15%,transparent);color:var(--sv-ok)}.sv-badge-warn{background:color-mix(in srgb,var(--sv-warn) 15%,transparent);color:var(--sv-warn)}.sv-badge-danger{background:color-mix(in srgb,var(--sv-danger) 15%,transparent);color:var(--sv-danger)}.sv-card{background:var(--sv-surface);border:1px solid var(--sv-border);border-radius:14px;padding:16px}.sv-field{display:grid;gap:6px;color:var(--sv-text-2);font-size:13px}.sv-field small{font-size:11px}.sv-input{width:100%;box-sizing:border-box;border:1px solid var(--sv-border);border-radius:10px;background:var(--sv-surface);color:var(--sv-text);padding:10px;font:inherit}
`;
