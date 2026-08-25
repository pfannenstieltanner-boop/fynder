import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileSearchResult } from '../types';
import { useAppStore } from '../store/appStore';
import { buildSnippet } from '../lib/search/buildSnippets';
import { flattenMatchLocations } from '../lib/search/matchLocations';
import { RESULTS_PAGE_SIZE } from '../lib/search/constants';
import { LEADING_WORD_COUNT, limitLeadingWords, splitSnippet } from '../lib/search/snippetFormatting';
import { buildPageWindow } from '../lib/pagination';

// The bottom panel of the results column: every instance for whichever file is currently
// selected (see ResultCard), decoupled from the card itself so switching instances never
// reflows the card grid above it. `result` is undefined until a card has been selected, or if
// the previously-selected file drops out of the current results (e.g. a file-type chip excludes
// it) — both render the same "pick something above" hint rather than a stale list.
//
// The flat match list (not document pages — see matchLocations.ts) is paginated in chunks of
// RESULTS_PAGE_SIZE, with a numbered pager at the bottom, rather than rendering every match or
// grouping by document page. Snippet text is built lazily, client-side, only for the chunk
// currently shown, so an arbitrarily large match count only ever costs one page's worth of work.
export default function OccurrenceList({ result }: { result: FileSearchResult | undefined }) {
  const previewTarget = useAppStore((s) => s.previewTarget);
  const openPreview = useAppStore((s) => s.openPreview);
  const file = useAppStore((s) => (result ? s.files[result.fileId] : undefined));
  const [resultsPage, setResultsPage] = useState(1);
  const activeRowRef = useRef<HTMLLIElement>(null);

  const isCurrentFile = !!result && previewTarget?.fileId === result.fileId;

  const matchLocations = useMemo(
    () => (result ? flattenMatchLocations(result.matchesByPage) : []),
    [result?.matchesByPage],
  );
  const totalPages = Math.max(1, Math.ceil(matchLocations.length / RESULTS_PAGE_SIZE));

  const activeOrdinal = isCurrentFile
    ? matchLocations.findIndex(
        (loc) => loc.pageNumber === previewTarget?.pageNumber && loc.matchIndexInPage === previewTarget?.matchIndex,
      )
    : -1;
  const activeResultsPage = activeOrdinal >= 0 ? Math.floor(activeOrdinal / RESULTS_PAGE_SIZE) + 1 : undefined;

  // Jumps the pager to whichever chunk holds the active match — switching files, or cycling to a
  // match outside the currently-shown chunk (e.g. via Enter), reveals it without a manual click.
  useEffect(() => {
    setResultsPage(activeResultsPage ?? 1);
  }, [result?.fileId, activeResultsPage]);

  // Unlike the result card's own scroll-on-select (which only fires when *switching files*),
  // this needs to scroll on every match change within the same file too — that's the whole point
  // of cycling through instances via Enter or clicking a different row.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [result?.fileId, previewTarget?.pageNumber, previewTarget?.matchIndex]);

  if (!result) {
    return <p className="occurrence-hint">Select a result above to see its instances.</p>;
  }

  const fileId = result.fileId;
  const start = (resultsPage - 1) * RESULTS_PAGE_SIZE;
  const visible = matchLocations.slice(start, start + RESULTS_PAGE_SIZE);
  const pageWindow = buildPageWindow(resultsPage, totalPages);

  function goToResultsPage(page: number) {
    setResultsPage(page);
    const first = matchLocations[(page - 1) * RESULTS_PAGE_SIZE];
    if (first) openPreview(fileId, first.pageNumber, first.matchIndexInPage);
  }

  return (
    <div className="occurrence-panel">
      <p className="occurrence-panel__file" title={result.fileName}>
        {result.fileName}
      </p>
      <ul className="occurrence-list">
        {visible.map((loc) => {
          const isActive =
            isCurrentFile &&
            previewTarget?.pageNumber === loc.pageNumber &&
            previewTarget?.matchIndex === loc.matchIndexInPage;
          const pageText = file?.pages.find((p) => p.pageNumber === loc.pageNumber)?.text ?? '';
          const match = result.matchesByPage[loc.pageNumber][loc.matchIndexInPage];
          const { before, matched, after } = splitSnippet(buildSnippet(pageText, match));
          const leadingText = limitLeadingWords(before, LEADING_WORD_COUNT);
          return (
            <li
              key={`${loc.pageNumber}:${loc.matchIndexInPage}`}
              ref={isActive ? activeRowRef : undefined}
              className={`occurrence-row${isActive ? ' occurrence-row--active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => openPreview(fileId, loc.pageNumber, loc.matchIndexInPage)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openPreview(fileId, loc.pageNumber, loc.matchIndexInPage);
                }
              }}
            >
              <span className="occurrence-row__page">p. {loc.pageNumber}</span>
              <span className="occurrence-row__text">
                {leadingText} <mark>{matched}</mark> {after}
              </span>
            </li>
          );
        })}
      </ul>
      {totalPages > 1 && (
        <div className="occurrence-pager" role="group" aria-label="Result pages">
          {pageWindow.map((token, i) =>
            token === 'ellipsis' ? (
              <span key={`ellipsis-${i}`} className="occurrence-pager__ellipsis">
                …
              </span>
            ) : (
              <button
                key={token}
                type="button"
                className={`occurrence-pager__page${token === resultsPage ? ' occurrence-pager__page--active' : ''}`}
                aria-current={token === resultsPage || undefined}
                onClick={() => goToResultsPage(token)}
              >
                {token}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
