import type { MatchRange } from '../../types';

export type { MatchRange } from '../../types';

export function findMatches(text: string, regex: RegExp, limit = 2_000): MatchRange[] {
  if (limit <= 0) return [];
  const matches: MatchRange[] = [];
  const flagged = regex.global ? regex : new RegExp(regex.source, regex.flags + 'g');
  flagged.lastIndex = 0;

  let match: RegExpExecArray | null;
  let lastIndex = -1;
  while ((match = flagged.exec(text)) !== null) {
    if (match[0].length === 0) {
      flagged.lastIndex++;
      if (flagged.lastIndex <= lastIndex) break;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
    lastIndex = flagged.lastIndex;
    if (matches.length >= limit) break;
  }
  return matches;
}
