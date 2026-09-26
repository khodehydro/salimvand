import { describe, expect, it } from 'vitest';
import {
  basketLabel,
  locationChip,
  locationLabel,
  placementChip,
  placementLabel,
} from './location-label';

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

describe('سبد labels — «انبار · قفسه · سبد» placement display', () => {
  const shelf = { code: 'A-03', name: 'قفسه جلو', parent: { name: 'انبار اصلی' } };

  it('names a basket by its code, without repeating the number', () => {
    expect(basketLabel({ code: 'B-2', name: 'سبد ۲' })).toBe('سبد B-2 — سبد ۲');
    expect(basketLabel({ code: '2', name: 'سبد ۲' })).toBe('سبد ۲');
    expect(basketLabel({ code: 'B-2' })).toBe('سبد B-2');
  });

  it('appends the basket to the shelf address', () => {
    const item = { location: shelf, basket: { code: '2', name: 'سبد ۲' } };
    expect(placementLabel(item)).toBe('انبار اصلی · A-03 — قفسه جلو · سبد ۲');
    expect(placementChip(item)).toBe('انبار اصلی · A-03 · سبد ۲');
  });

  it('stays usable when the line has no basket, no shelf, or neither', () => {
    expect(placementLabel({ location: shelf, basket: null })).toBe(
      'انبار اصلی · A-03 — قفسه جلو',
    );
    expect(placementLabel({ location: null, basket: { code: '2', name: 'سبد ۲' } })).toBe('سبد ۲');
    expect(placementLabel({ location: null, basket: null })).toBe('');
  });
});
