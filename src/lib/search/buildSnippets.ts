import type { MatchSegment } from '../../types';
import type { MatchRange } from './findMatches';
import { SNIPPET_RADIUS } from './constants';

export function buildSnippet(text: string, match: MatchRange): MatchSegment[] {
  const start = Math.max(0, match.start - SNIPPET_RADIUS);
  const end = Math.min(text.length, match.end + SNIPPET_RADIUS);

  const before = collapseWhitespace(text.slice(start, match.start));
  const matched = collapseWhitespace(text.slice(match.start, match.end));
  const after = collapseWhitespace(text.slice(match.end, end));

  const segments: MatchSegment[] = [];
  const prefix = (start > 0 ? '…' : '') + before;
  if (prefix) segments.push({ text: prefix, highlight: false });
  segments.push({ text: matched, highlight: true });
  const suffix = after + (end < text.length ? '…' : '');
  if (suffix) segments.push({ text: suffix, highlight: false });

  return segments;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}
