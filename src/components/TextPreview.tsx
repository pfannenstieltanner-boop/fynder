import { useEffect, useMemo, useRef } from 'react';
import { useSearch } from '../contexts/SearchContext';
import { buildFullHighlight } from '../lib/search/buildFullHighlight';
import type { FileRecord } from '../types';

export default function TextPreview({ file, matchIndex }: { file: FileRecord; matchIndex: number }) {
  const { query: debouncedQuery, results } = useSearch();
  const activeMarkRef = useRef<HTMLElement>(null);

  const text = file.pages[0]?.text ?? '';
  const matches = results.find((result) => result.fileId === file.id)?.matchesByPage[1] ?? [];

  const segments = useMemo(() => {
    return buildFullHighlight(text, matches);
  }, [text, matches]);

  // segments' highlighted entries correspond 1:1, in order, with the underlying match list — the
  // matchIndex-th one is the occurrence the results list (or preview footer) asked to land on.
  let activeHighlightPosition = -1;
  let seen = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].highlight) {
      if (seen === matchIndex) {
        activeHighlightPosition = i;
        break;
      }
      seen++;
    }
  }

  useEffect(() => {
    activeMarkRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [debouncedQuery, file.id, matchIndex]);

  return (
    <div className="text-preview__body">
      {segments.map((segment, i) =>
        segment.highlight ? (
          <mark
            key={i}
            ref={i === activeHighlightPosition ? activeMarkRef : undefined}
            className={i === activeHighlightPosition ? 'text-preview__mark--active' : undefined}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </div>
  );
}
