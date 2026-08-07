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
    const outcome = searchFiles({ one: input }, ['one'], ['x'], 'plain', 'any', /x/gi, [/x/gi]);

    expect(outcome.totalMatches).toBe(500);
    expect(outcome.truncated).toBe(true);
    expect(outcome.results[0].totalMatches).toBe(500);
    expect(outcome.results[0].occurrences).toHaveLength(50);
    expect(outcome.results[0].occurrencesTruncated).toBe(true);
    expect(outcome.results[0].matchesByPage[1]).toHaveLength(500);
  });

  it('searches partially processed files alongside done ones, each keeping its own full count', () => {
    const first = file('first', 'x '.repeat(300), 'partial');
    const second = file('second', 'x '.repeat(300));
    const outcome = searchFiles({ first, second }, ['first', 'second'], ['x'], 'plain', 'any', /x/gi, [/x/gi]);

    expect(outcome.results.map((result) => result.totalMatches)).toEqual([300, 300]);
    expect(outcome.totalMatches).toBe(600);
    expect(outcome.truncated).toBe(false);
  });

  it("does not let one file's match count depend on another file being included", () => {
    const a = file('a', 'x '.repeat(10));
    const b = file('b', 'x '.repeat(495));
    const c = file('c', 'x '.repeat(10));

    // b sits between a and c in file order but starts out excluded (e.g. its checkbox unchecked).
    const withoutB = searchFiles({ a, c }, ['a', 'b', 'c'], ['x'], 'plain', 'any', /x/gi, [/x/gi]);
    expect(withoutB.results.map((r) => r.totalMatches)).toEqual([10, 10]);

    // Including b must not shrink a's or b's own true counts, even though b's real total
    // (495) would have overflowed a shared, order-dependent budget.
    const withB = searchFiles({ a, b, c }, ['a', 'b', 'c'], ['x'], 'plain', 'any', /x/gi, [/x/gi]);
    const [aResult, bResult] = withB.results;
    expect(aResult.totalMatches).toBe(10);
    expect(bResult.totalMatches).toBe(495);
  });

  it('stops admitting further files once the running total reaches the cap, without trimming any already-admitted file', () => {
    const a = file('a', 'x '.repeat(300));
    const b = file('b', 'x '.repeat(300));
    const c = file('c', 'x '.repeat(10));
    const outcome = searchFiles({ a, b, c }, ['a', 'b', 'c'], ['x'], 'plain', 'any', /x/gi, [/x/gi]);

    expect(outcome.results.map((r) => r.fileId)).toEqual(['a', 'b']);
    expect(outcome.results.map((r) => r.totalMatches)).toEqual([300, 300]);
    expect(outcome.truncated).toBe(true);
  });

  it('"all" combine mode only admits files containing every term, but highlights every term once admitted', () => {
    const both = file('both', 'apple and banana');
    const appleOnly = file('appleOnly', 'apple pie');
    const terms = ['apple', 'banana'];
    const combined = /apple|banana/gi;
    const termRegexes = [/apple/gi, /banana/gi];

    const outcome = searchFiles(
      { both, appleOnly },
      ['both', 'appleOnly'],
      terms,
      'plain',
      'all',
      combined,
      termRegexes,
    );

    expect(outcome.results.map((r) => r.fileId)).toEqual(['both']);
    expect(outcome.results[0].totalMatches).toBe(2);
  });

  it('"any" combine mode admits a file containing just one of several terms', () => {
    const appleOnly = file('appleOnly', 'apple pie');
    const terms = ['apple', 'banana'];
    const combined = /apple|banana/gi;
    const termRegexes = [/apple/gi, /banana/gi];

    const outcome = searchFiles({ appleOnly }, ['appleOnly'], terms, 'plain', 'any', combined, termRegexes);

    expect(outcome.results.map((r) => r.fileId)).toEqual(['appleOnly']);
    expect(outcome.results[0].totalMatches).toBe(1);
  });
});

