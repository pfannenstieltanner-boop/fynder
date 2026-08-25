import { describe, expect, it } from 'vitest';
import { firstMatchLocation, flattenMatchLocations } from './matchLocations';

describe('flattenMatchLocations', () => {
  it('orders pages ascending regardless of key insertion order', () => {
    const matchesByPage = {
      3: [{ start: 0, end: 1 }],
      1: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
    };
    expect(flattenMatchLocations(matchesByPage)).toEqual([
      { pageNumber: 1, matchIndexInPage: 0 },
      { pageNumber: 1, matchIndexInPage: 1 },
      { pageNumber: 3, matchIndexInPage: 0 },
    ]);
  });

  it('returns an empty list for no matches', () => {
    expect(flattenMatchLocations({})).toEqual([]);
  });
});

describe('firstMatchLocation', () => {
  it('is the first match on the lowest-numbered page', () => {
    const matchesByPage = { 5: [{ start: 0, end: 1 }], 2: [{ start: 0, end: 1 }] };
    expect(firstMatchLocation(matchesByPage)).toEqual({ pageNumber: 2, matchIndexInPage: 0 });
  });

  it('is undefined for no matches', () => {
    expect(firstMatchLocation({})).toBeUndefined();
  });
});
