import { describe, expect, it } from 'vitest';
import { limitLeadingWords, splitSnippet } from './snippetFormatting';

describe('splitSnippet', () => {
  it('splits before/matched/after around the single highlighted segment', () => {
    expect(
      splitSnippet([
        { text: 'the big red dog readily ', highlight: false },
        { text: 'climbed', highlight: true },
        { text: ' the tree with the monkey', highlight: false },
      ]),
    ).toEqual({ before: 'the big red dog readily ', matched: 'climbed', after: ' the tree with the monkey' });
  });

  it('handles no leading or trailing segment', () => {
    expect(splitSnippet([{ text: 'climbed', highlight: true }])).toEqual({
      before: '',
      matched: 'climbed',
      after: '',
    });
  });
});

describe('limitLeadingWords', () => {
  it('leaves short leading text untouched', () => {
    expect(limitLeadingWords('the big red dog', 5)).toBe('the big red dog');
  });

  it('keeps only the last N words and prepends an ellipsis when trimmed', () => {
    expect(limitLeadingWords('the quick brown fox jumps over the lazy dog', 5)).toBe('… jumps over the lazy dog');
  });

  it('keeps an existing leading ellipsis without doubling it, even if not otherwise trimmed', () => {
    expect(limitLeadingWords('…brown fox', 5)).toBe('… brown fox');
  });

  it('combines an existing ellipsis with further word trimming into a single leading ellipsis', () => {
    expect(limitLeadingWords('…the quick brown fox jumps over the lazy dog', 5)).toBe('… jumps over the lazy dog');
  });

  it('returns the input unchanged when there is no text at all', () => {
    expect(limitLeadingWords('', 5)).toBe('');
  });
});
