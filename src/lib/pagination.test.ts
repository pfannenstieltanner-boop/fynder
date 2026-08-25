import { describe, expect, it } from 'vitest';
import { buildPageWindow } from './pagination';

describe('buildPageWindow', () => {
  it('windows around the current page with ellipses on both sides', () => {
    expect(buildPageWindow(5, 10)).toEqual([1, 'ellipsis', 3, 4, 5, 6, 7, 'ellipsis', 10]);
  });

  it('has no leading ellipsis when the window already touches page 1', () => {
    expect(buildPageWindow(1, 10)).toEqual([1, 2, 3, 'ellipsis', 10]);
    expect(buildPageWindow(3, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10]);
  });

  it('has no trailing ellipsis when the window already touches the last page', () => {
    expect(buildPageWindow(10, 10)).toEqual([1, 'ellipsis', 8, 9, 10]);
  });

  it('has no ellipses at all when everything fits', () => {
    expect(buildPageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles a single page', () => {
    expect(buildPageWindow(1, 1)).toEqual([1]);
  });

  it('returns nothing for zero pages', () => {
    expect(buildPageWindow(1, 0)).toEqual([]);
  });
});
