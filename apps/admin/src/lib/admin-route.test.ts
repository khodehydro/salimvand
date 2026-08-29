import { describe, expect, it } from 'vitest';
import { hashForPage, pageFromHash } from './admin-route';

describe('admin hash routes', () => {
  it('restores a valid page after reload or browser navigation', () => {
    expect(pageFromHash('#/inventory')).toBe('inventory');
    expect(pageFromHash('#/audit?user=u1')).toBe('audit');
  });

  it('falls back safely for empty and unknown routes', () => {
    expect(pageFromHash('')).toBe('dashboard');
    expect(pageFromHash('#/not-a-page')).toBe('dashboard');
  });

  it('creates stable shareable hashes', () => {
    expect(hashForPage('invoices')).toBe('#/invoices');
  });
});
