// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoreSliderSettings } from '@salimvand/shared';
import { StoreSliderEditor } from './StoreSliderEditor';
const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../lib/api', () => ({ api: mockApi }));
const first = { path: '/uploads/site/slide-ab12cd34.webp', alt: 'اول' };
const second = { path: '/uploads/site/slide-1234abcd.webp', alt: 'دوم' };
const busy = vi.fn();
function Editor({ initial = { slides: [first, second] } }: { initial?: StoreSliderSettings }) {
  const [value, setValue] = useState(initial);
  return <StoreSliderEditor value={value} onChange={setValue} onBusyChange={busy} />;
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('store slider settings editor', () => {
  it('reorders, edits alt text and removes slides without deleting a published file', () => {
    const { container } = render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: 'انتقال تصویر 2 به قبل' }));
    expect(container.querySelector('img')?.getAttribute('src')).toBe(second.path);
    fireEvent.change(screen.getByLabelText('توضیح تصویر ۱'), { target: { value: 'داخل فروشگاه' } });
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('داخل فروشگاه');
    fireEvent.click(screen.getAllByRole('button', { name: 'حذف از اسلایدر' })[0]);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(mockApi).not.toHaveBeenCalled();
  });
  it('uploads multipart images and appends the returned path, then requires saving', async () => {
    mockApi.mockResolvedValueOnce({ data: { path: '/uploads/site/slide-55555555.webp' } });
    const { container } = render(<Editor />);
    fireEvent.change(screen.getByLabelText('افزودن تصویر اسلایدر'), {
      target: { files: [new File(['png'], 'shop.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
    expect(mockApi).toHaveBeenCalledWith(
      '/media/settings/slide/upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
    expect(busy).toHaveBeenNthCalledWith(1, true);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('status').textContent).toContain('تنظیمات را ذخیره');
  });
  it('retains the list on upload failure and permits retry', async () => {
    mockApi.mockRejectedValueOnce(new Error('خطای شبکه'));
    const { container } = render(<Editor />);
    fireEvent.change(screen.getByLabelText('افزودن تصویر اسلایدر'), {
      target: { files: [new File(['jpg'], 'shop.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('خطای شبکه'));
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect((screen.getByLabelText('افزودن تصویر اسلایدر') as HTMLInputElement).disabled).toBe(
      false,
    );
  });
  it('rejects oversized or unsupported uploads before calling the server', () => {
    render(<Editor />);
    const input = screen.getByLabelText('افزودن تصویر اسلایدر');
    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'shop.svg', { type: 'image/svg+xml' })] },
    });
    expect(screen.getByRole('status').textContent).toContain('فرمت مجاز');
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'shop.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    expect(screen.getByRole('status').textContent).toContain('۵ مگابایت');
    expect(mockApi).not.toHaveBeenCalled();
  });
});
