import { lazy, Suspense } from 'react';
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
