import { useEffect, useRef } from 'react';
import type { FileSearchResult } from '../types';
import { useAppStore } from '../store/appStore';
import { firstMatchLocation } from '../lib/search/matchLocations';

// Compact by design: filename + match count only. Instances live in the separate occurrence
// panel below (see OccurrenceList), not inline here — keeping cards this small is what lets them
// sit in a scrollable grid without the whole column reflowing every time a file is selected.
export default function ResultCard({ result }: { result: FileSearchResult }) {
  const previewTarget = useAppStore((s) => s.previewTarget);
  const openPreview = useAppStore((s) => s.openPreview);
  const cardRef = useRef<HTMLLIElement>(null);

  const isSelected = previewTarget?.fileId === result.fileId;

  // Scrolls into view whenever this card *becomes* the selected file — clicking it, cycling here
  // via Enter, the preview footer's Prev/Next file buttons, or clicking the file in the sidebar
  // tree. Keyed on the isSelected transition, not every render, so re-clicking the same card
  // doesn't re-scroll it.
  useEffect(() => {
    if (!isSelected) return;
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isSelected]);

  const handleCardClick = () => {
    const first = firstMatchLocation(result.matchesByPage);
    if (first) openPreview(result.fileId, first.pageNumber, first.matchIndexInPage);
  };

  return (
    <li ref={cardRef} className={`result-card${isSelected ? ' result-card--selected' : ''}`}>
      <div
        className="result-card__body"
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
      >
        <span className="result-card__name" title={result.fileName}>
          {result.fileName}
        </span>
        <span className="result-card__count">{result.totalMatches}</span>
      </div>
    </li>
  );
}
