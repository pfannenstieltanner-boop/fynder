import { lazy, Suspense, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useSearch } from '../contexts/SearchContext';
import TextPreview from './TextPreview';
import type { FileRecord } from '../types';
import PreviewErrorBoundary from './PreviewErrorBoundary';

// Each of these pulls in a heavy renderer — pdf.js, utif2, and docx-preview respectively —
// none of which is needed until a preview of that type is actually opened. TextPreview stays
// eager: it has no dependencies beyond the search helpers already in the main chunk, so
// splitting it would only add a round-trip.
const PdfPreview = lazy(() => import('./PdfPreview'));
const TiffPreview = lazy(() => import('./TiffPreview'));
const DocxPreview = lazy(() => import('./DocxPreview'));

export default function PreviewShell({
  file,
  previewTarget,
  width,
}: {
  file: FileRecord;
  previewTarget: { fileId: string; pageNumber: number; matchIndex: number };
  width: number;
}) {
  const openPreview = useAppStore((s) => s.openPreview);
  const { results } = useSearch();

  const resultIndex = results.findIndex((r) => r.fileId === previewTarget.fileId);
  const currentResult = resultIndex >= 0 ? results[resultIndex] : null;
  const occurrences = currentResult?.occurrences ?? [];
  const occurrenceIndex = occurrences.findIndex(
    (o) => o.pageNumber === previewTarget.pageNumber && o.matchIndexInPage === previewTarget.matchIndex,
  );

  const hasMatchNav = !!currentResult && occurrenceIndex >= 0;
  const hasFileNav = results.length > 1;

  function stepMatch(delta: number) {
    if (!currentResult || occurrenceIndex < 0) return;
    const total = occurrences.length;
    const next = (occurrenceIndex + delta + total) % total;
    const occ = occurrences[next];
    openPreview(currentResult.fileId, occ.pageNumber, occ.matchIndexInPage);
  }

  function stepFile(delta: number) {
    if (results.length === 0) return;
    const baseIndex = resultIndex >= 0 ? resultIndex : 0;
    const total = results.length;
    const next = (baseIndex + delta + total) % total;
    const target = results[next];
    const first = target.occurrences[0];
    if (first) openPreview(target.fileId, first.pageNumber, first.matchIndexInPage);
  }

  // Enter advances to the next instance in the Instance list (this results column), not just the
  // next match within the current file — once the current file's last shown occurrence is
  // reached, it rolls into the next file's first occurrence, wrapping back to the first file
  // after the last. Repeated presses must keep advancing every time, so this deliberately does
  // *not* try to tell "focus is still sitting on the row that was active a moment ago" apart from
  // "focus is on some other row" — after the first press moves the active instance elsewhere,
  // focus itself doesn't move (React keeps the same DOM node for that row), so any check tied to
  // that row's now-stale active state would only ever let the very first Enter through.
  //
  // Registered on the *capture* phase, not bubble: a result card and each occurrence row are
  // themselves `role="button"` divs with their own Enter handler (select-this-row) that calls
  // stopPropagation(). A bubble-phase listener here would simply never see the keydown when one
  // of those rows has focus — capture runs top-down before that local handler gets a chance to
  // stop it. stopPropagation() below keeps that local handler from also firing afterward with the
  // now-stale occurrence it captured.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || !currentResult || occurrenceIndex < 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || active.isContentEditable) {
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation();
      if (occurrenceIndex + 1 < occurrences.length) {
        const occ = occurrences[occurrenceIndex + 1];
        openPreview(currentResult.fileId, occ.pageNumber, occ.matchIndexInPage);
        return;
      }
      if (results.length === 0) return;
      const nextFileIndex = (resultIndex + 1) % results.length;
      const nextResult = results[nextFileIndex];
      const first = nextResult.occurrences[0];
      if (first) openPreview(nextResult.fileId, first.pageNumber, first.matchIndexInPage);
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [currentResult, occurrenceIndex, occurrences, results, resultIndex, openPreview]);

  return (
    <div className="preview-pane" style={{ width }}>
      <div className="preview-pane__header">
        <span className="preview-pane__name" title={file.name}>
          {file.name}
        </span>
      </div>
      <PreviewErrorBoundary key={`${file.id}:${previewTarget.pageNumber}`}>
        <Suspense fallback={<p className="preview-pane__status">Loading preview…</p>}>
        {file.fileType === 'pdf' ? (
          <PdfPreview file={file} pageNumber={previewTarget.pageNumber} matchIndex={previewTarget.matchIndex} />
        ) : file.fileType === 'tiff' ? (
          <TiffPreview file={file} pageNumber={previewTarget.pageNumber} matchIndex={previewTarget.matchIndex} />
        ) : file.fileType === 'docx' ? (
          <DocxPreview file={file} matchIndex={previewTarget.matchIndex} />
        ) : (
          <TextPreview file={file} matchIndex={previewTarget.matchIndex} />
        )}
        </Suspense>
      </PreviewErrorBoundary>
      {(hasMatchNav || hasFileNav) && (
        <div className="preview-footer">
          {hasMatchNav && (
            <div className="preview-footer__row">
              <button
                type="button"
                className="preview-footer__nav-btn"
                onClick={() => stepMatch(-1)}
                aria-label="Previous match"
              >
                ‹
              </button>
              <span className="preview-footer__label">
                Match {occurrenceIndex + 1} of {occurrences.length}
                {currentResult!.occurrencesTruncated ? ' shown' : ''}
              </span>
              <button
                type="button"
                className="preview-footer__nav-btn"
                onClick={() => stepMatch(1)}
                aria-label="Next match"
              >
                ›
              </button>
            </div>
          )}
          {hasFileNav && (
            <div className="preview-footer__row preview-footer__file-nav">
              <button type="button" className="preview-footer__file-btn" onClick={() => stepFile(-1)}>
                ◂ Prev file
              </button>
              <button type="button" className="preview-footer__file-btn" onClick={() => stepFile(1)}>
                Next file ▸
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
