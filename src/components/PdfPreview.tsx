import { useEffect, useRef, useState } from 'react';
import { useSearch } from '../contexts/SearchContext';
import { useZoomPan, type Size } from '../hooks/useZoomPan';
import { getDocumentForFile, renderPageToCanvas } from '../lib/pdf/renderPage';
import { drawHighlights } from '../lib/highlight/drawHighlights';
import ZoomToolbar from './ZoomToolbar';
import type { FileRecord } from '../types';

const PREVIEW_SCALE = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function PdfPreview({
  file,
  pageNumber,
  matchIndex,
}: {
  file: FileRecord;
  pageNumber: number;
  matchIndex: number;
}) {
  const { results } = useSearch();

  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  // Remembers which (file, page, match) we last auto-zoomed for, so editing the search query
  // doesn't yank the view around on every keystroke — only a genuinely new match target does.
  const zoomTargetKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canvasNativeSize, setCanvasNativeSize] = useState<Size | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(matchIndex);

  const fileId = file.id;
  const page = file.pages.find((p) => p.pageNumber === pageNumber);

  const { wrapSize, stackStyle, zoomPercent, stepZoom, resetFit, focusRect } = useZoomPan(
    scrollWrapRef,
    canvasNativeSize,
    fileId,
  );

  // A fresh navigation (new page, or an explicit match clicked in the results list) resets local
  // cycling state to whatever was requested.
  useEffect(() => {
    setCurrentMatchIndex(matchIndex);
  }, [fileId, pageNumber, matchIndex]);

  // Base render: expensive (full page rasterization), only on file/page change. View is left
  // alone here — the overlay effect below owns deciding the right zoom once matches are known.
  useEffect(() => {
    if (!fileId || !pageNumber || !baseCanvasRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    setCanvasNativeSize(null);

    (async () => {
      try {
        const doc = await getDocumentForFile(fileId);
        if (cancelled || !baseCanvasRef.current) return;
        const { width, height } = await renderPageToCanvas(
          doc,
          pageNumber,
          PREVIEW_SCALE,
          baseCanvasRef.current,
          controller.signal,
        );
        if (cancelled) return;
        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width = width;
          overlayCanvasRef.current.height = height;
        }
        setCanvasNativeSize({ width, height });
      } catch (err) {
        if (!cancelled && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to render preview.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fileId, pageNumber]);

  // Overlay redraw: cheap (rect fills only), stays in sync as the live search query/mode/active
  // match changes. Auto-zooms to a comfortable reading level only when landing on a genuinely
  // new match (a fresh page/navigation, or cycling to a different instance) — not on every
  // keystroke while editing the query.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !page) return;

    const matches = results.find((result) => result.fileId === fileId)?.matchesByPage[pageNumber] ?? [];

    if (matches.length === 0) {
      drawHighlights(canvas, [], [], PREVIEW_SCALE, 0);
      zoomTargetKeyRef.current = null;
      resetFit();
      return;
    }

    const clampedIndex = clamp(currentMatchIndex, 0, matches.length - 1);
    if (clampedIndex !== currentMatchIndex) {
      setCurrentMatchIndex(clampedIndex);
      return; // this effect re-runs immediately with the corrected index
    }

    const activeRect = drawHighlights(canvas, page.boxes, matches, PREVIEW_SCALE, clampedIndex);

    // Also requires canvasNativeSize/wrapSize: on the very first render of a freshly-opened
    // page, the base page rasterization is still in flight (async), so there's no viewport to
    // center within yet. Waiting for it (rather than just consuming zoomTargetKeyRef
    // prematurely) lets this re-fire once the render actually lands.
    const targetKey = `${fileId}:${pageNumber}:${clampedIndex}`;
    if (activeRect && canvasNativeSize && wrapSize && zoomTargetKeyRef.current !== targetKey) {
      zoomTargetKeyRef.current = targetKey;
      focusRect(activeRect);
    }
    // `loading` is included so the overlay redraws once the base render (which sets the
    // overlay canvas's width/height) finishes, rather than drawing into a stale/zero-sized canvas.
  }, [page, results, loading, currentMatchIndex, fileId, pageNumber, canvasNativeSize, wrapSize, focusRect, resetFit]);

  return (
    <>
      <ZoomToolbar
        zoomPercent={zoomPercent}
        disabled={!canvasNativeSize}
        onStep={stepZoom}
        onFit={resetFit}
        pageInfo={file.pageCount ? { current: pageNumber, total: file.pageCount } : null}
      />
      <div className="preview-pane__canvas-wrap" ref={scrollWrapRef}>
        {loading && <p className="preview-pane__status">Rendering…</p>}
        {error && <p className="preview-pane__status preview-pane__status--error">{error}</p>}
        <div className="preview-pane__canvas-stack" style={stackStyle}>
          <canvas ref={baseCanvasRef} className="preview-pane__canvas" />
          <canvas ref={overlayCanvasRef} className="preview-pane__canvas preview-pane__canvas--overlay" />
        </div>
      </div>
    </>
  );
}
