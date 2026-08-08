import { useEffect, useRef, useState } from 'react';
import type { FileSearchResult } from '../types';
import { useAppStore } from '../store/appStore';
import MatchSnippet from './MatchSnippet';

export default function ResultCard({ result }: { result: FileSearchResult }) {
  const previewTarget = useAppStore((s) => s.previewTarget);
  const openPreview = useAppStore((s) => s.openPreview);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);

  const isSelected = previewTarget?.fileId === result.fileId;
  const isMulti = result.totalMatches > 1;

  // Whenever this card *becomes* the selected file — clicking it here, cycling here via Enter,
  // the preview footer's Prev/Next file buttons, or clicking the file in the sidebar tree — it
  // auto-expands and scrolls into view, so its instances are visible without an extra click or
  // hunting for it in a long results list. Keyed on the isSelected transition rather than running
  // every render so a user can still manually collapse an already-selected card without this
  // immediately reopening it, and so re-clicking the same already-open card doesn't re-scroll it.
  useEffect(() => {
    if (!isSelected) return;
    if (isMulti) setExpanded(true);
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isSelected, isMulti]);

  const handleCardClick = () => {
    const first = result.occurrences[0];
    openPreview(result.fileId, first.pageNumber, first.matchIndexInPage);
    if (isMulti) setExpanded((v) => !v);
  };

  return (
    <li ref={cardRef} className={`result-card${isSelected ? ' result-card--selected' : ''}`}>
      <div
        className="result-card__body"
        role="button"
        tabIndex={0}
        aria-expanded={isMulti ? expanded : undefined}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <div className="result-card__thumb" />
        <div className="result-card__main">
          <div className="result-card__top">
            <span className="result-card__name" title={result.fileName}>
              {result.fileName}
            </span>
            <div className="result-card__meta">
              <span className="result-card__count">{result.totalMatches}</span>
              {isMulti && (
                <span
                  className={`result-card__chevron${expanded ? ' result-card__chevron--open' : ''}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              )}
            </div>
          </div>
          <p className="result-card__snippet">
            <MatchSnippet segments={result.primarySnippet} />
          </p>
        </div>
      </div>
      {isMulti && expanded && (
        <div className="result-card__occurrences">
          {result.occurrences.map((occ, i) => {
            const isActive =
              isSelected &&
              previewTarget?.pageNumber === occ.pageNumber &&
              previewTarget?.matchIndex === occ.matchIndexInPage;
            return (
              <div
                key={i}
                className={`occurrence-row${isActive ? ' occurrence-row--active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  openPreview(result.fileId, occ.pageNumber, occ.matchIndexInPage);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    openPreview(result.fileId, occ.pageNumber, occ.matchIndexInPage);
                  }
                }}
              >
                <MatchSnippet segments={occ.segments} />
              </div>
            );
          })}
          {result.occurrencesTruncated && (
            <p className="result-card__more">+{result.totalMatches - result.occurrences.length} more not shown</p>
          )}
        </div>
      )}
    </li>
  );
}
