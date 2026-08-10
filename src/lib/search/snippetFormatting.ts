import type { MatchSegment } from '../../types';

// Fixed, small — not tied to pane width — so the match reliably lands a short, predictable
// distance in from the left rather than drifting with however much text happens to precede it.
export const LEADING_WORD_COUNT = 5;

export interface SplitSnippet {
  before: string;
  matched: string;
  after: string;
}

// buildSnippet always returns, in order, an optional leading non-highlighted segment, exactly one
// highlighted (the match) segment, and an optional trailing non-highlighted segment. Splitting
// them out into separate before/matched/after strings lets the leading side be capped to a fixed
// word count (see limitLeadingWords) independent of the trailing side, which is left free to run
// — and then simply clipped from the end as the pane narrows, standard single-line ellipsis
// behavior. This replaced an earlier attempt to keep the match visually *centered* via a CSS
// start-ellipsis (direction: rtl) trick on the leading side — that turned out to be an unreliable
// technique in practice (the ellipsis rendered on the wrong side); capping to a fixed word count
// sidesteps the need for any such trick entirely, at the cost of the match not being dead-center,
// just consistently near the left.
export function splitSnippet(segments: MatchSegment[]): SplitSnippet {
  const matchIndex = segments.findIndex((s) => s.highlight);
  if (matchIndex === -1) return { before: segments.map((s) => s.text).join(''), matched: '', after: '' };
  return {
    before: segments
      .slice(0, matchIndex)
      .map((s) => s.text)
      .join(''),
    matched: segments[matchIndex].text,
    after: segments
      .slice(matchIndex + 1)
      .map((s) => s.text)
      .join(''),
  };
}

// Caps `before` to its last `maxWords` words. buildSnippet may already have prepended a literal
// "…" (there was more text beyond its own SNIPPET_RADIUS window) — that's stripped and accounted
// for separately, so a leading ellipsis is added whenever text was cut for *either* reason,
// without ever doubling up.
export function limitLeadingWords(before: string, maxWords: number): string {
  const hadEllipsis = before.startsWith('…');
  const raw = (hadEllipsis ? before.slice(1) : before).trim();
  if (!raw) return before;
  const words = raw.split(/\s+/);
  const kept = words.slice(-maxWords).join(' ');
  return hadEllipsis || words.length > maxWords ? `… ${kept}` : kept;
}
