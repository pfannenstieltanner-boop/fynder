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
  // The scale the base canvas actually rendered at — usually PREVIEW_SCALE, but renderPageToCanvas
  // reduces it for oversized pages (large-format sheets) to stay within a safe raster budget.
  // Highlight math must use this, not the PREVIEW_SCALE constant, or boxes land at the wrong
  // pixel positions whenever the two diverge.
  const [renderScale, setRenderScale] = useState(PREVIEW_SCALE);
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
        const { width, height, scale } = await renderPageToCanvas(
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
        setRenderScale(scale);
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
    // canvasNativeSize is what actually gates this: it's null until the base-render effect has
    // both resized this canvas to match the base raster *and* set renderScale to the value that
    // was actually used. Search results (and so `matches`) are available independent of preview
    // rendering, so without this guard the effect would draw immediately using whatever stale or
    // default size the canvas happened to have — briefly for a fast render, but for a
    // large-format sheet's multi-second rasterization, "briefly" is long enough to see: highlight
    // rects computed for a 6000px+ raster, drawn into a canvas still at its 300x150 default and
    // then stretched by CSS to fill the pane, come out as thin, misaligned slivers.
    if (!canvas || !page || !canvasNativeSize) return;

    const matches = results.find((result) => result.fileId === fileId)?.matchesByPage[pageNumber] ?? [];

    if (matches.length === 0) {
      drawHighlights(canvas, [], [], renderScale, 0);
      zoomTargetKeyRef.current = null;
      resetFit();
      return;
    }

    const clampedIndex = clamp(currentMatchIndex, 0, matches.length - 1);
    if (clampedIndex !== currentMatchIndex) {
      setCurrentMatchIndex(clampedIndex);
      return; // this effect re-runs immediately with the corrected index
    }

    const activeRect = drawHighlights(canvas, page.boxes, matches, renderScale, clampedIndex);

    // wrapSize still needs its own check: the viewport (scroll container) can measure a size
    // independent of whether the canvas raster is ready, so it's not covered by the guard above.
    const targetKey = `${fileId}:${pageNumber}:${clampedIndex}`;
    if (activeRect && wrapSize && zoomTargetKeyRef.current !== targetKey) {
      zoomTargetKeyRef.current = targetKey;
      focusRect(activeRect);
    }
  }, [page, results, currentMatchIndex, fileId, pageNumber, canvasNativeSize, wrapSize, renderScale, focusRect, resetFit]);

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
        {loading && (
          <p className="preview-pane__status preview-pane__status--loading">
            <span className="spinner" aria-hidden="true" />
            Rendering…
          </p>
        )}
        {error && <p className="preview-pane__status preview-pane__status--error">{error}</p>}
        <div className="preview-pane__canvas-stack" style={stackStyle}>
          <canvas ref={baseCanvasRef} className="preview-pane__canvas" />
          <canvas ref={overlayCanvasRef} className="preview-pane__canvas preview-pane__canvas--overlay" />
        </div>
      </div>
    </>
  );
}
