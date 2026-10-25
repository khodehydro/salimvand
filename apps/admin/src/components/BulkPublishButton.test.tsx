// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BulkPublishButton } from './BulkPublishButton';

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../lib/api', () => ({ api: mockApi }));
const endpoint = '/notifications/bulk-publish';
const props = {
  categories: [
    { id: 'cat1', name: 'قطعات داشبورد' },
    { id: 'cat2', name: 'چراغ' },
  ],
  brands: [{ id: 'brand1', name: 'بوش' }],
  vehicles: [
    {
      id: 'make1',
      name: 'پژو',
      models: [
        { id: 'model1', name: 'پارس' },
        { id: 'model2', name: '۲۰۶' },
      ],
    },
  ],
};
const job = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: Date.now(),
  total: 200,
  batches: 20,
  batchSize: 10,
  state: 'active',
  cancelRequested: false,
  platforms: ['telegram', 'bale'],
  filters: { mode: 'all' },
  progress: {
    status: 'running',
    cursor: 10,
    sent: { telegram: 10, bale: 10 },
    failed: { telegram: 0, bale: 0 },
    skipped: { telegram: 0, bale: 0 },
    issues: [],
  },
};
function route(path: string, init?: RequestInit) {
  if (path === endpoint && !init?.method) return Promise.resolve({ data: [] });
  if (path.endsWith('/preview')) return Promise.resolve({ data: { count: 200, batches: 20 } });
  if (path === endpoint && init?.method === 'POST') return Promise.resolve({ data: job });
  if (path.endsWith('/cancel')) return Promise.resolve({ data: { ...job, cancelRequested: true } });
  throw new Error(`Unexpected request ${path}`);
}
function open() {
  mockApi.mockImplementation(route);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal('crypto', { randomUUID: () => job.id });
  render(<BulkPublishButton {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'انتشار گروهی' }));
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockApi.mockReset();
});

describe('bulk publish dialog', () => {
  it('does not load queue history until opened and does not start without preview', async () => {
    render(<BulkPublishButton {...props} />);
    expect(mockApi).not.toHaveBeenCalled();
    mockApi.mockImplementation(route);
    fireEvent.click(screen.getByRole('button', { name: 'انتشار گروهی' }));
    expect(screen.getByRole('dialog', { name: 'انتشار گروهی محصولات' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'شروع انتشار گروهی' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith(endpoint));
  });
  it('selects multiple vehicles and categories with intersection and previews the count', async () => {
    open();
    fireEvent.change(screen.getByLabelText('نوع انتشار'), { target: { value: 'combined' } });
    fireEvent.click(screen.getByLabelText('پژو پارس'));
    fireEvent.click(screen.getByLabelText('پژو ۲۰۶'));
    fireEvent.click(screen.getByLabelText('قطعات داشبورد'));
    fireEvent.click(screen.getByRole('button', { name: 'محاسبهٔ تعداد محصولات' }));
    await waitFor(() =>
      expect(screen.getByText('۲۰۰ محصول — ۲۰ مرحلهٔ حداکثر ۱۰تایی')).toBeTruthy(),
    );
    const previewCall = mockApi.mock.calls.find(([path]) => path.endsWith('/preview'))!;
    expect(JSON.parse(previewCall[1].body)).toMatchObject({
      mode: 'combined',
      vehicleModelIds: ['model1', 'model2'],
      categoryIds: ['cat1'],
      match: 'and',
    });
    fireEvent.click(screen.getByLabelText('فقط محصولات دارای موجودی'));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'شروع انتشار گروهی' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });
  it('starts with selected channels and keeps progress visible after closing and reopening', async () => {
    open();
    fireEvent.click(screen.getByLabelText('بله'));
    fireEvent.click(screen.getByRole('button', { name: 'محاسبهٔ تعداد محصولات' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'شروع انتشار گروهی' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'شروع انتشار گروهی' }));
    await waitFor(() => expect(screen.getByLabelText('پیشرفت محصولات')).toBeTruthy());
    const start = mockApi.mock.calls.find(
      ([path, init]) => path === endpoint && init?.method === 'POST',
    )!;
    expect(JSON.parse(start[1].body)).toMatchObject({ platforms: ['telegram'], requestId: job.id });
    fireEvent.click(screen.getByRole('button', { name: 'بستن انتشار گروهی' }));
    mockApi.mockImplementation((path: string, init?: RequestInit) =>
      path === endpoint && !init?.method ? Promise.resolve({ data: [job] }) : route(path, init),
    );
    fireEvent.click(screen.getByRole('button', { name: 'انتشار گروهی' }));
    await waitFor(() =>
      expect((screen.getByLabelText('پیشرفت محصولات') as HTMLProgressElement).value).toBe(10),
    );
    fireEvent.click(screen.getByRole('button', { name: 'توقف ادامهٔ انتشار' }));
    await waitFor(() => expect(screen.getByText('در حال توقف')).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith(`${endpoint}/${job.id}/cancel`, { method: 'POST' });
  });
  it('shows the correct final stage for a partial last batch', async () => {
    mockApi.mockResolvedValue({
      data: [
        {
          ...job,
          total: 23,
          batches: 3,
          state: 'completed',
          progress: { ...job.progress, cursor: 23, status: 'completed' },
        },
      ],
    });
    render(<BulkPublishButton {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'انتشار گروهی' }));
    await waitFor(() => expect(screen.getByText(/۳ از ۳ مرحله/)).toBeTruthy());
  });

  it('reports API errors instead of silently starting an empty campaign', async () => {
    open();
    mockApi.mockImplementation((path: string, init?: RequestInit) =>
      path.endsWith('/preview')
        ? Promise.reject(new Error('حداقل یک خودرو انتخاب کنید'))
        : route(path, init),
    );
    fireEvent.change(screen.getByLabelText('نوع انتشار'), { target: { value: 'vehicles' } });
    fireEvent.click(screen.getByRole('button', { name: 'محاسبهٔ تعداد محصولات' }));
    await waitFor(() => expect(screen.getByText('حداقل یک خودرو انتخاب کنید')).toBeTruthy());
    expect(
      (screen.getByRole('button', { name: 'شروع انتشار گروهی' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
