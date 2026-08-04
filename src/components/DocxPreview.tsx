import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { useSearch } from '../contexts/SearchContext';
import { useZoomPan, type Size } from '../hooks/useZoomPan';
import { getFile } from '../lib/pdf/fileCache';
import type { MatchRange } from '../lib/search/findMatches';
import { findMatchesInWorker } from '../lib/search/searchWorkerClient';
import ZoomToolbar from './ZoomToolbar';
import type { FileRecord } from '../types';
import { DOCX_RENDER_OPTIONS, sanitizeRenderedDocument } from '../lib/docx/security';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  return nodes;
}

function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll('mark[data-fynder-mark]').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  });
}

// Wraps each match's text range in a <mark>, working from the last match to the first so that
// earlier matches' [start,end) offsets — computed once against the pre-mutation text — stay valid
// as later (higher-offset) splits happen first.
function applyHighlights(root: HTMLElement, matches: MatchRange[], activeIndex: number): HTMLElement | null {
  const textNodes = collectTextNodes(root);
  const boundaries: Array<{ node: Text; start: number; end: number }> = [];
  let cursor = 0;
  for (const node of textNodes) {
    const start = cursor;
    cursor += node.data.length;
    boundaries.push({ node, start, end: cursor });
  }

  let activeEl: HTMLElement | null = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end } = matches[i];
    const isActive = i === activeIndex;
    for (const b of boundaries) {
      if (b.end <= start || b.start >= end) continue;
      const localStart = Math.max(0, start - b.start);
      const localEnd = Math.min(b.node.data.length, end - b.start);
      if (localStart >= localEnd) continue;
      const matchNode = b.node.splitText(localStart);
      matchNode.splitText(localEnd - localStart);
      const mark = document.createElement('mark');
      mark.dataset.fynderMark = '1';
      if (isActive) mark.className = 'text-preview__mark--active';
      matchNode.replaceWith(mark);
      mark.appendChild(matchNode);
      if (isActive) activeEl = mark;
    }
  }
  return activeEl;
}

export default function DocxPreview({ file, matchIndex }: { file: FileRecord; matchIndex: number }) {
  const { query, mode } = useSearch();

  const contentRef = useRef<HTMLDivElement>(null);
  const styleContainerRef = useRef<HTMLDivElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const zoomTargetKeyRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contentSize, setContentSize] = useState<Size | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(matchIndex);
  const [renderVersion, setRenderVersion] = useState(0);

  const fileId = file.id;

  const { wrapSize, fitScale, viewRef, stackStyle, zoomPercent, stepZoom, resetFit, focusRect } = useZoomPan(
    scrollWrapRef,
    contentSize,
    fileId,
  );

  useEffect(() => {
    setCurrentMatchIndex(matchIndex);
  }, [fileId, matchIndex]);

  // Base render: load the cached raw file bytes and render the document into the container via
  // docx-preview, which produces real paginated page sections (page size, margins, box-shadow)
  // matching Word's own look — not just a plain-text dump. Expensive, only on file change.
  useEffect(() => {
    const container = contentRef.current;
    const styleContainer = styleContainerRef.current;
    if (!fileId || !container || !styleContainer) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    setContentSize(null);

    (async () => {
      try {
        const rawFile = getFile(fileId);
        if (!rawFile) throw new Error('Original file is no longer available.');
        const detachedContent = document.createElement('div');
        const detachedStyles = document.createElement('div');
        await renderAsync(rawFile, detachedContent, detachedStyles, DOCX_RENDER_OPTIONS);
        if (cancelled) return;
        sanitizeRenderedDocument(detachedContent);
        container.replaceChildren(...Array.from(detachedContent.childNodes));
        styleContainer.replaceChildren(...Array.from(detachedStyles.childNodes));
        setRenderVersion((v) => v + 1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render preview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // Measures the rendered document's natural (untransformed) size: a single page's own width
  // (pages don't stretch to fill the pane) plus the full stacked height of every page, re-checked
  // as late-loading fonts/images shift layout.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const measure = () => {
      const page = container.querySelector<HTMLElement>('section');
      if (!page) return;
      setContentSize({ width: page.offsetWidth, height: container.scrollHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fileId, renderVersion]);

  // Highlighting: walks the rendered document's own text nodes (independent of the plain-text
  // extraction used for the results list) so highlight positions always match what's on screen.
  // `matchIndex` is treated as an ordinal ("the Nth match in reading order") — both extractions
  // agree on that ordering for the vast majority of documents even when their exact text/offsets
  // differ slightly, the same assumption the PDF/TIFF previews already make against their own
  // independently-extracted per-page text.
  useEffect(() => {
    const container = contentRef.current;
    if (!container || loading || error) return;

    clearHighlights(container);
    if (!query) {
      zoomTargetKeyRef.current = null;
      resetFit();
      return;
    }
    let active = true;
    const task = findMatchesInWorker(container.textContent ?? '', query, mode, 500);
    void task.promise
      .then((matches) => {
        if (!active) return;
        if (matches.length === 0) {
          zoomTargetKeyRef.current = null;
          resetFit();
          return;
        }

        const clampedIndex = clamp(currentMatchIndex, 0, matches.length - 1);
        if (clampedIndex !== currentMatchIndex) {
          setCurrentMatchIndex(clampedIndex);
          return;
        }

        const activeEl = applyHighlights(container, matches, clampedIndex);
        const targetKey = `${fileId}:${clampedIndex}`;
        if (activeEl && contentSize && wrapSize && zoomTargetKeyRef.current !== targetKey) {
          zoomTargetKeyRef.current = targetKey;
          const effectiveZoomNow = viewRef.current?.zoom ?? fitScale;
          const containerRect = container.getBoundingClientRect();
          const markRect = activeEl.getBoundingClientRect();
          focusRect({
            x: (markRect.left - containerRect.left) / effectiveZoomNow,
            y: (markRect.top - containerRect.top) / effectiveZoomNow,
            width: markRect.width / effectiveZoomNow,
            height: markRect.height / effectiveZoomNow,
          });
        }
      })
      .catch(() => {
        if (active) resetFit();
      });
    return () => {
      active = false;
      task.cancel();
    };
  }, [
    query,
    mode,
    loading,
    error,
    currentMatchIndex,
    fileId,
    contentSize,
    wrapSize,
    fitScale,
    viewRef,
    focusRect,
    resetFit,
  ]);

  return (
    <>
      <ZoomToolbar zoomPercent={zoomPercent} disabled={!contentSize} onStep={stepZoom} onFit={resetFit} />
      <div className="preview-pane__canvas-wrap" ref={scrollWrapRef}>
        {loading && <p className="preview-pane__status">Rendering…</p>}
        {error && <p className="preview-pane__status preview-pane__status--error">{error}</p>}
        <div style={{ display: 'none' }} ref={styleContainerRef} />
        <div className="docx-preview__stack" style={stackStyle}>
          <div className="docx-preview__container" ref={contentRef} />
        </div>
      </div>
    </>
  );
}
