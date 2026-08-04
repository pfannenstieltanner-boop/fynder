import type { SearchMode } from '../../types';

export type BuildRegexResult = { regex: RegExp } | { error: string };

export function buildSearchRegex(query: string, mode: SearchMode): BuildRegexResult {
  if (query.length === 0) return { error: '' };
  const pattern = mode === 'plain' ? escapeRegExp(query) : query;
  try {
    return { regex: new RegExp(pattern, 'gi') };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid pattern.' };
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
