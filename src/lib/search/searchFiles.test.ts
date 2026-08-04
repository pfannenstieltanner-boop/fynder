import { describe, expect, it } from 'vitest';
import { findMatches } from './findMatches';
import { searchFiles, type SearchableFile } from './searchFiles';

function file(id: string, text: string, status: SearchableFile['status'] = 'done'): SearchableFile {
  return {
    id,
    name: `${id}.txt`,
    fileType: 'text',
    status,
    pages: [{ pageNumber: 1, text }],
  };
}

describe('findMatches', () => {
  it('enforces the requested limit exactly', () => {
    expect(findMatches('aaaaaa', /a/g, 3)).toHaveLength(3);
  });

  it('advances safely for zero-length expressions', () => {
    expect(findMatches('abc', /(?=.)/g, 10)).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });
});

describe('searchFiles', () => {
  it('caps a single file at 500 matches and reports truncation', () => {
    const input = file('one', 'x '.repeat(600));
    const outcome = searchFiles({ one: input }, ['one'], 'x', 'plain', /x/gi);

    expect(outcome.totalMatches).toBe(500);
    expect(outcome.truncated).toBe(true);
    expect(outcome.results[0].totalMatches).toBe(500);
    expect(outcome.results[0].occurrences).toHaveLength(50);
    expect(outcome.results[0].occurrencesTruncated).toBe(true);
    expect(outcome.results[0].matchesByPage[1]).toHaveLength(500);
  });

  it('searches partially processed files and shares the global budget', () => {
    const first = file('first', 'x '.repeat(300), 'partial');
    const second = file('second', 'x '.repeat(300));
    const outcome = searchFiles({ first, second }, ['first', 'second'], 'x', 'plain', /x/gi);

    expect(outcome.totalMatches).toBe(500);
    expect(outcome.results.map((result) => result.totalMatches)).toEqual([300, 200]);
    expect(outcome.truncated).toBe(true);
  });
});

