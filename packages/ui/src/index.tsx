import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { APP_NAME } from '@salimvand/shared';

export const designTokens = {
  brand: { 950: '#04121f', 900: '#071c30', 800: '#0d2b4b', 600: '#175894', 500: '#1f6fbe' },
  light: { background: '#f3f6fa', surface: '#ffffff', text: '#0b1c2f' },
  dark: { background: '#050b14', surface: '#0d1826', text: '#eaf1f9' },
} as const;

export function BrandButton({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button {...props} data-brand={APP_NAME}>{children}</button>;
}
