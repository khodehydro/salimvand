// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_MINI_APP_SETTINGS } from '@salimvand/shared';
import { MiniAppSettingsEditor } from './MiniAppSettingsEditor';
vi.mock('../lib/public-site', () => ({ publicSiteUrl: 'https://shop.example' }));
function Editor() {
  const [value, setValue] = useState(DEFAULT_MINI_APP_SETTINGS);
  return <MiniAppSettingsEditor value={value} onChange={setValue} />;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('mini app site settings', () => {
  it('starts with channel changes disabled and shows provider-specific HTTPS addresses', () => {
    render(<Editor />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByLabelText('آدرس وب مینی‌اپ تلگرام برای BotFather') as HTMLInputElement).value,
    ).toBe('https://shop.example/mini/telegram');
    expect(
      (screen.getByLabelText('آدرس وب مینی‌اپ بله برای BotFather') as HTMLInputElement).value,
    ).toBe('https://shop.example/mini/bale');
  });
  it('allows testing/copying a launch link before enabling new channel post buttons', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('نام کاربری ربات/بازوی تلگرام'), {
      target: { value: '@store_bot' },
    });
    expect(
      (screen.getByLabelText('لینک اجرای مینی‌اپ تلگرام برای کانال') as HTMLInputElement).value,
    ).toBe('https://t.me/store_bot?startapp');
    fireEvent.click(screen.getByRole('button', { name: 'کپی متن پیام سنجاق‌شدهٔ تلگرام' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('https://t.me/store_bot?startapp'),
      ),
    );
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
  it('does not generate executable links from invalid usernames', () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText('نام کاربری ربات/بازوی بله'), {
      target: { value: 'evil?redirect=1' },
    });
    expect(screen.queryByLabelText('لینک اجرای مینی‌اپ بله برای کانال')).toBeNull();
  });
});
