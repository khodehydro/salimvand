// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MiniPhoneBar } from './MiniPhoneBar';
vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch: _prefetch,
    ...props
  }: React.PropsWithChildren<{ prefetch?: boolean }>) => <a {...props}>{children}</a>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function clipboard(writeText?: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}
describe('mini phone bar', () => {
  it('reads the supplied store number, displays Persian digits and copies dialable ASCII with leading zero', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    clipboard(write);
    render(<MiniPhoneBar phone="۰۹۱۲ ۱۲۳ ۴۵۶۷" base="/mini/telegram" />);
    const link = screen.getByRole('link', { name: 'تماس با فروشگاه' });
    expect(link.getAttribute('href')).toBe('tel:09121234567');
    expect(link.textContent).toContain('۰۹۱۲۱۲۳۴۵۶۷');
    fireEvent.click(screen.getByRole('button', { name: 'کپی شماره' }));
    await screen.findByText('شماره تماس کپی شد.');
    expect(write).toHaveBeenCalledWith('09121234567');
  });
  it('falls back when the messenger rejects the Clipboard API and removes the temporary field', async () => {
    clipboard(vi.fn().mockRejectedValue(new Error('Permission denied')));
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    render(<MiniPhoneBar phone="+98 912 1234567" base="/mini/bale" />);
    const button = screen.getByRole('button', { name: 'کپی شماره' });
    button.focus();
    fireEvent.click(button);
    await screen.findByText('شماره تماس کپی شد.');
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it('gives an honest manual-copy message rather than false success in unsupported WebViews', async () => {
    clipboard();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    render(<MiniPhoneBar phone="04445221234" base="/mini/bale" />);
    fireEvent.click(screen.getByRole('button', { name: 'کپی شماره' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('دستی کپی کنید'));
    expect(screen.queryByText('شماره تماس کپی شد.')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('does not invent a number or render an enabled copy button when contact settings are empty', () => {
    render(<MiniPhoneBar base="/mini/bale" />);
    expect(screen.queryByRole('button', { name: 'کپی شماره' })).toBeNull();
    expect(screen.getByRole('link', { name: 'اطلاعات فروشگاه' }).getAttribute('href')).toBe(
      '/mini/bale/contact',
    );
  });
});
