import { describe, expect, it, vi } from 'vitest';
import { ReportsController } from './reports.controller';

function responseMock() {
  return { setHeader: vi.fn(), send: vi.fn((body: string) => body) };
}

describe('ReportsController', () => {
  it('exports sales as UTF-8 CSV with a real BOM', async () => {
    const exportSales = vi.fn(async () => 'شماره,مبلغ\nINV-1,1000');
    const response = responseMock();
    const controller = new ReportsController({ exportSales } as never);

    const result = await controller.exportSales('2026-08-01', '2026-08-29', response as never);

    expect(exportSales).toHaveBeenCalledWith('2026-08-01', '2026-08-29');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(result.charCodeAt(0)).toBe(0xfeff);
    expect(result).not.toMatch(/^\\uFEFF/);
  });
});
