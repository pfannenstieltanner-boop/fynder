import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { searchFilesInWorker } from '../lib/search/searchWorkerClient';
import type { SearchableFile } from '../lib/search/searchFiles';
import type { FileSearchResult, SearchMode, SearchTermsMode } from '../types';

export interface SearchState {
  /** Debounced — the raw text currently in the search box (not yet committed as a term). */
  query: string;
  /** The terms actually being searched: committed chips plus the in-progress query, deduped.
   *  In regex mode this is always a single entry (the query itself) — chips are plain-mode only. */
  terms: string[];
  mode: SearchMode;
  combineMode: SearchTermsMode;
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
  regexError: string | null;
  searching: boolean;
}

const EMPTY: SearchState = {
  query: '',
  terms: [],
  mode: 'plain',
  combineMode: 'all',
  results: [],
  totalMatches: 0,
  truncated: false,
  regexError: null,
  searching: false,
};

const SearchContext = createContext<SearchState>(EMPTY);

/**
 * Single owner of the debounce and the cross-file search.
 *
 * Both were previously duplicated: `useSearchResults` ran independently in ResultsColumn
 * and PreviewShell (doubling the work whenever a preview was open), and six components
 * each ran their own 200ms timer — which could fire on different ticks and briefly leave
 * the results list and the preview overlay disagreeing about the current query.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const mode = useAppStore((s) => s.searchMode);
  const searchTerms = useAppStore((s) => s.searchTerms);
  const combineMode = useAppStore((s) => s.searchTermsMode);
  const files = useAppStore((s) => s.files);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const searchFileTypes = useAppStore((s) => s.searchFileTypes);
  const query = useDebouncedValue(searchQuery, 200);

  // The committed chips plus whatever's still being typed — so results (and the preview
  // highlight) keep updating live while the next term is in progress, exactly like today's
  // single-term search did, rather than only reacting once Tab commits it. Regex mode has no
  // chips (the UI disables them there — one regex can already express any combination), so it's
  // always just the query itself.
  const terms = useMemo(() => {
    if (mode === 'regex') return query.length > 0 ? [query] : [];
    const draft = query.trim();
    const combined = draft.length > 0 ? [...searchTerms, draft] : searchTerms;
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const term of combined) {
      const key = term.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(term);
    }
    return deduped;
  }, [mode, query, searchTerms]);

  const searchableFiles = useMemo(() => {
    const result: Record<string, SearchableFile> = {};
    for (const id of fileOrder) {
      const file = files[id];
      if (!file || (file.status !== 'done' && file.status !== 'partial')) continue;
      if (!file.includedInSearch) continue;
      if (!searchFileTypes.includes(file.fileType)) continue;
      result[id] = {
        id: file.id,
        name: file.name,
        fileType: file.fileType,
        status: file.status,
        pages: file.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
      };
    }
    return result;
  }, [files, fileOrder, searchFileTypes]);

  const [outcome, setOutcome] = useState({ results: [] as FileSearchResult[], totalMatches: 0, truncated: false });
  const [regexError, setRegexError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (terms.length === 0) {
      setOutcome({ results: [], totalMatches: 0, truncated: false });
      setRegexError(null);
      setSearching(false);
      return;
    }

    // Deliberately does *not* blank `outcome` before the new search resolves. `searchableFiles`
    // changes reference — and re-triggers this effect — every time any loading file appends a
    // page, including files with no bearing on what's currently searched or previewed. Resetting
    // to empty here made results (and, downstream, the preview's highlights) flash to nothing and
    // back on every one of those background updates: PdfPreview's highlight effect treats a
    // momentary empty match list as "no match", clearing the overlay and resetting the zoom, then
    // re-zooms back in a moment later once real results land — a visible double-snap while
    // stepping through matches during a large batch import. Keeping the previous, still-valid
    // results on screen until the fresh ones are ready avoids that; `searching` is still there for
    // callers that want a loading indicator without losing what's currently shown.
    let active = true;
    setSearching(true);
    const task = searchFilesInWorker(searchableFiles, fileOrder, terms, mode, combineMode);
    void task.promise
      .then((next) => {
        if (!active) return;
        setOutcome(next);
        setRegexError(null);
        setSearching(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRegexError(error instanceof Error ? error.message : 'Search failed.');
        setSearching(false);
      });
    return () => {
      active = false;
      task.cancel();
    };
  }, [searchableFiles, fileOrder, terms, mode, combineMode]);

  const value = useMemo<SearchState>(() => {
    if (terms.length === 0) return { ...EMPTY, mode, combineMode };
    return { query, terms, mode, combineMode, ...outcome, regexError, searching };
  }, [query, terms, mode, combineMode, outcome, regexError, searching]);

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  return useContext(SearchContext);
}
