import { useAppStore } from '../store/appStore';
import { useSearch } from '../contexts/SearchContext';
import ResultCard from './ResultCard';

export default function ResultsColumn() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchMode = useAppStore((s) => s.searchMode);
  const setSearchMode = useAppStore((s) => s.setSearchMode);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const { query: debouncedQuery, results, totalMatches, truncated, regexError, searching } = useSearch();

  const isRegex = searchMode === 'regex';
  const hasFiles = fileOrder.length > 0;

  return (
    <div className="results-column">
      <div className="search-row">
        <div className="search-pill">
          <svg className="search-pill__icon" width="14" height="14" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <line x1="11" y1="11" x2="15" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder={isRegex ? 'Search with a regular expression…' : 'Search across all loaded files…'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`regex-toggle${isRegex ? ' regex-toggle--active' : ''}`}
          onClick={() => setSearchMode(isRegex ? 'plain' : 'regex')}
          aria-pressed={isRegex}
        >
          Use regex
        </button>
      </div>

      {!hasFiles ? (
        <div className="empty-step-area">
          <div className="empty-step">
            <div className="empty-step__badge">2</div>
            <div className="empty-step__title">Search</div>
            <div className="empty-step__desc">Type a term above</div>
          </div>
        </div>
      ) : debouncedQuery.length === 0 ? (
        <p className="results-hint">Type above to search across all processed files.</p>
      ) : searching ? (
        <p className="results-hint">Searching…</p>
      ) : regexError ? (
        <p className="results-error">Invalid search: {regexError}</p>
      ) : results.length === 0 ? (
        <p className="results-hint">No matches found for "{debouncedQuery}".</p>
      ) : (
        <>
          <p className="results-summary">
            {totalMatches} match{totalMatches === 1 ? '' : 'es'} across {results.length} file
            {results.length === 1 ? '' : 's'}
            {truncated && ' — showing the first 500 matches; refine your search'}
          </p>
          <ul className="results-list">
            {results.map((result) => (
              <ResultCard key={result.fileId} result={result} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
