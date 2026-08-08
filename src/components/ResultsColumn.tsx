import { useAppStore } from '../store/appStore';
import { useSearch } from '../contexts/SearchContext';
import { ALL_FILE_TYPES, FILE_TYPE_LABELS } from '../lib/files/fileTypes';
import ResultCard from './ResultCard';
import OccurrenceList from './OccurrenceList';

function describeTerms(terms: string[], combineMode: 'any' | 'all'): string {
  if (terms.length === 1) return `"${terms[0]}"`;
  const joiner = combineMode === 'all' ? ' and ' : ' or ';
  return terms.map((term) => `"${term}"`).join(joiner);
}

export default function ResultsColumn() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const searchMode = useAppStore((s) => s.searchMode);
  const setSearchMode = useAppStore((s) => s.setSearchMode);
  const searchTerms = useAppStore((s) => s.searchTerms);
  const commitSearchTerm = useAppStore((s) => s.commitSearchTerm);
  const removeSearchTerm = useAppStore((s) => s.removeSearchTerm);
  const searchTermsMode = useAppStore((s) => s.searchTermsMode);
  const setSearchTermsMode = useAppStore((s) => s.setSearchTermsMode);
  const searchFileTypes = useAppStore((s) => s.searchFileTypes);
  const toggleSearchFileType = useAppStore((s) => s.toggleSearchFileType);
  const setAllSearchFileTypes = useAppStore((s) => s.setAllSearchFileTypes);
  const fileOrder = useAppStore((s) => s.fileOrder);
  const previewTarget = useAppStore((s) => s.previewTarget);
  const { terms, results, totalMatches, truncated, regexError, searching, combineMode } = useSearch();

  const allTypesSelected = searchFileTypes.length === ALL_FILE_TYPES.length;
  const selectedResult = results.find((result) => result.fileId === previewTarget?.fileId);

  const isRegex = searchMode === 'regex';
  const hasFiles = fileOrder.length > 0;

  return (
    <div className="results-column">
      <div className="search-section">
        <div className="search-row">
          <div className="search-pill">
            <svg className="search-pill__icon" width="14" height="14" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="11" y1="11" x2="15" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {!isRegex &&
              searchTerms.map((term) => (
                <span className="search-term-chip" key={term}>
                  {term}
                  <button type="button" aria-label={`Remove ${term}`} onClick={() => removeSearchTerm(term)}>
                    ×
                  </button>
                </span>
              ))}
            <input
              type="text"
              placeholder={
                isRegex
                  ? 'Search with a regular expression…'
                  : searchTerms.length > 0
                    ? 'Add another term (Tab)…'
                    : 'Search across all loaded files… (Tab to add another term)'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (isRegex) return;
                if (e.key === 'Tab' && searchQuery.trim().length > 0) {
                  e.preventDefault();
                  commitSearchTerm();
                } else if (e.key === 'Backspace' && searchQuery.length === 0 && searchTerms.length > 0) {
                  removeSearchTerm(searchTerms[searchTerms.length - 1]);
                }
              }}
            />
          </div>
          {!isRegex && searchTerms.length > 0 && (
            <button
              type="button"
              className="term-combine-toggle"
              onClick={() => setSearchTermsMode(searchTermsMode === 'all' ? 'any' : 'all')}
              title="Toggle whether a file must contain every term, or just one"
            >
              Match {searchTermsMode === 'all' ? 'all' : 'any'}
            </button>
          )}
          <button
            type="button"
            className={`regex-toggle${isRegex ? ' regex-toggle--active' : ''}`}
            onClick={() => setSearchMode(isRegex ? 'plain' : 'regex')}
            aria-pressed={isRegex}
          >
            Use regex
          </button>
        </div>

        <div className="filetype-chips" role="group" aria-label="Filter search by file type">
          <button
            type="button"
            className={`filetype-chip${allTypesSelected ? ' filetype-chip--active' : ' filetype-chip--muted'}`}
            aria-pressed={allTypesSelected}
            onClick={setAllSearchFileTypes}
          >
            All
          </button>
          {ALL_FILE_TYPES.map((type) => {
            // While "All" covers everything (the default), individual chips read as grayed-out
            // rather than each showing active — they're included, just not individually chosen.
            // Once the user picks a specific type, "All" itself grays out instead (see above).
            const active = !allTypesSelected && searchFileTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                className={`filetype-chip${active ? ' filetype-chip--active' : ''}${allTypesSelected ? ' filetype-chip--muted' : ''}`}
                aria-pressed={active}
                onClick={() => toggleSearchFileType(type)}
              >
                {FILE_TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
      </div>

      {!hasFiles ? (
        <div className="empty-step-area">
          <div className="empty-step">
            <div className="empty-step__badge">2</div>
            <div className="empty-step__title">Search</div>
            <div className="empty-step__desc">Type a term above</div>
          </div>
        </div>
      ) : terms.length === 0 ? (
        <p className="results-hint">Type above to search across all processed files.</p>
      ) : searching ? (
        <p className="results-hint">Searching…</p>
      ) : regexError ? (
        <p className="results-error">Invalid search: {regexError}</p>
      ) : results.length === 0 ? (
        <p className="results-hint">No matches found for {describeTerms(terms, combineMode)}.</p>
      ) : (
        <div className="results-panels">
          <div className="results-panel results-panel--cards">
            <p className="results-summary">
              {totalMatches} match{totalMatches === 1 ? '' : 'es'} across {results.length} file
              {results.length === 1 ? '' : 's'}
              {truncated && ' — showing the first 500 matches; refine your search'}
            </p>
            <ul className="results-grid">
              {results.map((result) => (
                <ResultCard key={result.fileId} result={result} />
              ))}
            </ul>
          </div>
          <div className="results-panel results-panel--occurrences">
            <OccurrenceList result={selectedResult} />
          </div>
        </div>
      )}
    </div>
  );
}
