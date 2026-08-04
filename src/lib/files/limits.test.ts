import { describe, expect, it } from 'vitest';
import { MAX_PAGE_DIMENSION, MAX_PAGE_PIXELS, isPageSizeAllowed } from './limits';

describe('isPageSizeAllowed', () => {
  it('accepts ordinary pages and rejects invalid or oversized dimensions', () => {
    expect(isPageSizeAllowed(2_550, 3_300)).toBe(true);
    expect(isPageSizeAllowed(0, 100)).toBe(false);
    expect(isPageSizeAllowed(MAX_PAGE_DIMENSION + 1, 1)).toBe(false);
    expect(isPageSizeAllowed(MAX_PAGE_PIXELS, 2)).toBe(false);
  });
});
