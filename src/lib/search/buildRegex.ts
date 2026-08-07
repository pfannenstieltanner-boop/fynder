import type { SearchMode } from '../../types';

export interface BuiltSearchRegex {
  /** Matches any of the terms — used to find and highlight every occurrence, regardless of
   *  combine mode. Even in "all" mode, once a file qualifies, every term's hits are shown. */
  regex: RegExp;
  /** One regex per term, in the same order as the input — used only to test whether a given
   *  term appears *somewhere* in a file, for "all" mode's admission check. */
  termRegexes: RegExp[];
}

export type BuildRegexResult = BuiltSearchRegex | { error: string };

/**
 * Builds search regexes from one or more terms. In plain mode each term is escaped before being
 * OR'd together; in regex mode `terms` always has exactly one entry (the UI disables multi-term
 * chips there) and it's used as-is, unescaped, matching the single-pattern behavior this replaced.
 */
export function buildSearchRegex(terms: string[], mode: SearchMode): BuildRegexResult {
  const nonEmpty = terms.filter((term) => term.length > 0);
  if (nonEmpty.length === 0) return { error: '' };
  try {
    const patterns = nonEmpty.map((term) => (mode === 'plain' ? escapeRegExp(term) : term));
    const termRegexes = patterns.map((pattern) => new RegExp(pattern, 'gi'));
    const regex = new RegExp(patterns.join('|'), 'gi');
    return { regex, termRegexes };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid pattern.' };
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
