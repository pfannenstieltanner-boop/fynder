import type { MatchSegment } from '../../types';
import type { MatchRange } from './findMatches';

/**
 * Like buildSnippet, but returns the *entire* text as segments instead of a windowed
 * excerpt around one match — used by the plain-text preview, which has no fixed "page" to
 * scroll to a snippet within, so it shows the whole document with every match highlighted.
 */
export function buildFullHighlight(text: string, matches: MatchRange[]): MatchSegment[] {
  if (matches.length === 0) return [{ text, highlight: false }];

  const segments: MatchSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), highlight: false });
    }
    segments.push({ text: text.slice(match.start, match.end), highlight: true });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }
  return segments;
}
