import { useEffect, useRef, useState } from 'react';
import { useSearch } from '../contexts/SearchContext';
import { useZoomPan, type Size } from '../hooks/useZoomPan';
import { getTiffDocument, renderTiffPageToCanvas } from '../lib/tiff/renderTiffPage';
import { drawHighlights } from '../lib/highlight/drawHighlights';
import ZoomToolbar from './ZoomToolbar';
import type { FileRecord } from '../types';

// A TIFF's native pixel resolution already is the canonical (scale=1) reference frame that
// WordBoxes are stored in — unlike PDF's PREVIEW_SCALE, there's no separate raster-vs-canonical
// gap to bridge, so highlight math uses this fixed 1 rather than a tunable constant.
const PREVIEW_SCALE = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function TiffPreview({
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

  useEffect(() => {
    setCurrentMatchIndex(matchIndex);
  }, [fileId, pageNumber, matchIndex]);

  useEffect(() => {
    if (!fileId || !pageNumber || !baseCanvasRef.current) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    setCanvasNativeSize(null);

    (async () => {
      try {
        const doc = await getTiffDocument(fileId);
        if (cancelled || !baseCanvasRef.current) return;
        const rotation = page?.rotation ?? 0;
        const { width, height } = await renderTiffPageToCanvas(doc, pageNumber, rotation, baseCanvasRef.current);
        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width = width;
          overlayCanvasRef.current.height = height;
        }
        setCanvasNativeSize({ width, height });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render preview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, pageNumber, page?.rotation]);

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
      return;
    }

    const activeRect = drawHighlights(canvas, page.boxes, matches, PREVIEW_SCALE, clampedIndex);

    const targetKey = `${fileId}:${pageNumber}:${clampedIndex}`;
    if (activeRect && canvasNativeSize && wrapSize && zoomTargetKeyRef.current !== targetKey) {
      zoomTargetKeyRef.current = targetKey;
      focusRect(activeRect);
    }
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
