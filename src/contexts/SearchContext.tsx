import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { searchFilesInWorker } from '../lib/search/searchWorkerClient';
import type { SearchableFile } from '../lib/search/searchFiles';
import type { FileSearchResult, SearchMode } from '../types';

export interface SearchState {
  /** Debounced — the query the results and previews are actually showing. */
  query: string;
  mode: SearchMode;
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
  regexError: string | null;
  searching: boolean;
}

const EMPTY: SearchState = {
  query: '',
  mode: 'plain',
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
  const files = useAppStore((s) => s.files);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const query = useDebouncedValue(searchQuery, 200);
  const searchableFiles = useMemo(() => {
    const result: Record<string, SearchableFile> = {};
    for (const id of fileOrder) {
      const file = files[id];
      if (!file || (file.status !== 'done' && file.status !== 'partial')) continue;
      if (!file.includedInSearch) continue;
      result[id] = {
        id: file.id,
        name: file.name,
        fileType: file.fileType,
        status: file.status,
        pages: file.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
      };
    }
    return result;
  }, [files, fileOrder]);

  const [outcome, setOutcome] = useState({ results: [] as FileSearchResult[], totalMatches: 0, truncated: false });
  const [regexError, setRegexError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.length === 0) {
      setOutcome({ results: [], totalMatches: 0, truncated: false });
      setRegexError(null);
      setSearching(false);
      return;
    }

    let active = true;
    setOutcome({ results: [], totalMatches: 0, truncated: false });
    setRegexError(null);
    setSearching(true);
    const task = searchFilesInWorker(searchableFiles, fileOrder, query, mode);
    void task.promise
      .then((next) => {
        if (!active) return;
        setOutcome(next);
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
  }, [searchableFiles, fileOrder, query, mode]);

  const value = useMemo<SearchState>(() => {
    if (query.length === 0) return { ...EMPTY, mode };
    return { query, mode, ...outcome, regexError, searching };
  }, [query, mode, outcome, regexError, searching]);

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  return useContext(SearchContext);
}
