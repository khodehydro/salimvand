import { describe, expect, it } from 'vitest';
import { locationChip, locationLabel } from './location-label';

describe('location labels — «انبار · قفسه» placement display', () => {
  it('shows the warehouse group and the shelf together', () => {
    const shelf = { code: 'A-03', name: 'قفسه جلو', parent: { name: 'انبار اصلی' } };
    expect(locationLabel(shelf)).toBe('انبار اصلی · A-03 — قفسه جلو');
    expect(locationChip(shelf)).toBe('انبار اصلی · A-03');
  });

  it('falls back to the bare shelf when it has no warehouse yet', () => {
    const shelf = { code: 'B-09', name: 'قفسه عقب', parent: null };
    expect(locationLabel(shelf)).toBe('B-09 — قفسه عقب');
    expect(locationChip(shelf)).toBe('B-09');
  });
});
