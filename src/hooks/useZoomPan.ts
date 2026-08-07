import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

// Shared by the PDF, TIFF, and DOCX previews, which previously each carried their own copy of
// all of this (~200 near-identical lines apiece). The three differ only in how they produce
// their content — a rasterized canvas, a decoded frame, a rendered DOM tree — not in how the
// viewport behaves over it.

export interface Size {
  width: number;
  height: number;
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_SENSITIVITY = 0.0012;
export const TARGET_MATCH_HEIGHT_PX = 32;
// Auto-zoom-to-match (focusRect) previously zoomed all the way to TARGET_MATCH_HEIGHT_PX; this
// backs it off by about a third, landing on a less aggressive, still-readable zoom level.
const FOCUS_ZOOM_MULTIPLIER = 2 / 3;
// Below this much pointer movement, a left/middle-button press is treated as a click rather than
// a pan drag, so an ordinary click doesn't twitch the view by a stray pixel.
const DRAG_THRESHOLD_PX = 3;
// The zoom buttons step in fixed 25%-of-fit-scale increments, clamped 50–200%, matching the
// design spec. Wheel-zoom and drag-pan stay unconstrained by that range — they're the richer,
// continuous interaction layered on top.
export const ZOOM_STEP_PERCENT = 25;
const ZOOM_PERCENT_MIN = 50;
const ZOOM_PERCENT_MAX = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Centers content that's smaller than the viewport (matching the old "fit" behavior), or
// restricts panning so at least some of the content always stays in view when it's larger.
function clampAxis(pan: number, contentSize: number, viewportSize: number): number {
  if (contentSize <= viewportSize) return (viewportSize - contentSize) / 2;
  return clamp(pan, viewportSize - contentSize, 0);
}

function fitPan(scale: number, wrapSize: Size | null, contentSize: Size | null): { panX: number; panY: number } {
  if (!wrapSize || !contentSize) return { panX: 0, panY: 0 };
  return {
    panX: (wrapSize.width - contentSize.width * scale) / 2,
    panY: (wrapSize.height - contentSize.height * scale) / 2,
  };
}

export interface ZoomPan {
  wrapSize: Size | null;
  fitScale: number;
  /** null = auto-fit-to-pane (default, stays centered/reactive to resize). */
  view: ViewState | null;
  /** Mirrors `view` for imperative reads without a stale-closure risk. */
  viewRef: RefObject<ViewState | null>;
  /** Inline transform for the content wrapper. undefined until content size is known. */
  stackStyle: CSSProperties | undefined;
  zoomPercent: number;
  stepZoom: (deltaPercent: number) => void;
  resetFit: () => void;
  /** Zooms/pans so a rect in content coordinates sits centered at a readable size. */
  focusRect: (rect: Rect) => void;
}

export function useZoomPan(
  wrapRef: RefObject<HTMLElement>,
  contentSize: Size | null,
  /** Re-attaches the resize observer; the wrap element doesn't exist until a preview opens. */
  resetKey: string,
): ZoomPan {
  const [wrapSize, setWrapSize] = useState<Size | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const viewRef = useRef<ViewState | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Track the scrollable viewport's actual size so "fit to pane" and pan clamping can be
  // computed precisely in JS rather than relying on CSS percentage-height cascades through flex
  // containers, which don't reliably resolve here.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWrapSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [wrapRef, resetKey]);

  const fitScale =
    contentSize && wrapSize
      ? Math.min(wrapSize.width / contentSize.width, wrapSize.height / contentSize.height)
      : 1;

  // Ctrl+wheel zoom: the factor scales with the wheel event's own deltaY instead of a fixed
  // step, so a mouse's few large "notches" and a trackpad's many small ticks both feel
  // proportional to the actual gesture. Keeping the content point under the cursor fixed on
  // screen is exact algebra on our own translate/scale state (no DOM scroll read/write, no
  // waiting for a repaint), so there's nothing left to round or clamp away.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;
      const factor = clamp(Math.exp(-e.deltaY * ZOOM_SENSITIVITY), 0.8, 1.25);

      // Pure function of (prev, closed-over fitScale/wrapSize/contentSize) — safe under
      // StrictMode's dev-only double-invocation of updater functions.
      setView((prev) => {
        const base = prev ?? { zoom: fitScale, ...fitPan(fitScale, wrapSize, contentSize) };
        const contentX = (clientX - base.panX) / base.zoom;
        const contentY = (clientY - base.panY) / base.zoom;
        const nextZoom = clamp(base.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        return {
          zoom: nextZoom,
          panX: clientX - contentX * nextZoom,
          panY: clientY - contentY * nextZoom,
        };
      });
    };

    wrap.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', handleWheel);
  }, [wrapRef, fitScale, wrapSize, contentSize]);

  // Click-drag panning: left mouse button for a dedicated pan gesture, and middle mouse button
  // preserved as an alternate (matching the browser's native middle-click autoscroll this
  // transform-based viewport no longer provides for free).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let dragging = false;
    let moved = false;
    let startClientX = 0;
    let startClientY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let pointerId: number | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      dragging = true;
      moved = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      const current = viewRef.current ?? { zoom: fitScale, ...fitPan(fitScale, wrapSize, contentSize) };
      startPanX = current.panX;
      startPanY = current.panY;
      pointerId = e.pointerId;
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nice-to-have (keeps the drag going if the cursor leaves the wrap); if the
        // browser won't grant it for this pointer, panning still works via plain move/up events.
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startClientX;
      const dy = e.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) moved = true;
      if (!moved) return;
      setView((prev) => ({ zoom: prev?.zoom ?? fitScale, panX: startPanX + dx, panY: startPanY + dy }));
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (pointerId != null) {
        try {
          wrap.releasePointerCapture(pointerId);
        } catch {
          // Capture may already have been released by the browser (e.g. pointercancel).
        }
      }
      pointerId = null;
    };

    wrap.addEventListener('pointerdown', handlePointerDown);
    wrap.addEventListener('pointermove', handlePointerMove);
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    return () => {
      wrap.removeEventListener('pointerdown', handlePointerDown);
      wrap.removeEventListener('pointermove', handlePointerMove);
      wrap.removeEventListener('pointerup', endDrag);
      wrap.removeEventListener('pointercancel', endDrag);
    };
  }, [wrapRef, fitScale, wrapSize, contentSize]);

  const effectiveZoom = view?.zoom ?? fitScale;

  const stackStyle = useMemo<CSSProperties | undefined>(() => {
    if (!contentSize) return undefined;
    const fallback = fitPan(fitScale, wrapSize, contentSize);
    const rawPanX = view?.panX ?? fallback.panX;
    const rawPanY = view?.panY ?? fallback.panY;
    const contentWidth = contentSize.width * effectiveZoom;
    const contentHeight = contentSize.height * effectiveZoom;
    const panX = wrapSize ? clampAxis(rawPanX, contentWidth, wrapSize.width) : rawPanX;
    const panY = wrapSize ? clampAxis(rawPanY, contentHeight, wrapSize.height) : rawPanY;
    return {
      width: contentSize.width,
      height: contentSize.height,
      transform: `translate(${panX}px, ${panY}px) scale(${effectiveZoom})`,
    };
  }, [contentSize, wrapSize, view, fitScale, effectiveZoom]);

  // Toolbar zoom buttons: step in fixed percent-of-fit increments, anchored to the viewport
  // center (rather than the cursor, since a button click has no cursor position over the content
  // to anchor to).
  const stepZoom = useCallback(
    (delta: number) => {
      if (!wrapSize) return;
      const base = viewRef.current ?? { zoom: fitScale, ...fitPan(fitScale, wrapSize, contentSize) };
      const currentPercent = (base.zoom / fitScale) * 100;

      // Wheel-zoom or auto-zoom-to-match can leave the actual zoom well outside the button's
      // [50,200]% grid (e.g. auto-zoomed to 490% for legibility on tiny text). "+" must never
      // decrease zoom and "-" must never increase it, so out-of-range values re-enter the range
      // from the near edge rather than snapping onto the grid first (which could land on the far
      // side of the requested step, reversing the click's direction).
      let nextPercent: number;
      if (delta > 0 && currentPercent >= ZOOM_PERCENT_MAX) {
        return; // already beyond what zooming in via the button can offer
      } else if (delta < 0 && currentPercent <= ZOOM_PERCENT_MIN) {
        return; // already below what zooming out via the button can offer
      } else if (currentPercent > ZOOM_PERCENT_MAX) {
        nextPercent = ZOOM_PERCENT_MAX;
      } else if (currentPercent < ZOOM_PERCENT_MIN) {
        nextPercent = ZOOM_PERCENT_MIN;
      } else {
        const snapped = Math.round(currentPercent / ZOOM_STEP_PERCENT) * ZOOM_STEP_PERCENT;
        nextPercent = clamp(snapped + delta, ZOOM_PERCENT_MIN, ZOOM_PERCENT_MAX);
      }

      const anchorX = wrapSize.width / 2;
      const anchorY = wrapSize.height / 2;
      const nextZoom = fitScale * (nextPercent / 100);
      const contentX = (anchorX - base.panX) / base.zoom;
      const contentY = (anchorY - base.panY) / base.zoom;
      setView({
        zoom: nextZoom,
        panX: anchorX - contentX * nextZoom,
        panY: anchorY - contentY * nextZoom,
      });
    },
    [wrapSize, contentSize, fitScale],
  );

  const resetFit = useCallback(() => setView(null), []);

  const focusRect = useCallback(
    (rect: Rect) => {
      if (!wrapSize) return;
      const targetZoom = clamp((TARGET_MATCH_HEIGHT_PX / rect.height) * FOCUS_ZOOM_MULTIPLIER, ZOOM_MIN, ZOOM_MAX);
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      setView({
        zoom: targetZoom,
        panX: wrapSize.width / 2 - centerX * targetZoom,
        panY: wrapSize.height / 2 - centerY * targetZoom,
      });
    },
    [wrapSize],
  );

  return {
    wrapSize,
    fitScale,
    view,
    viewRef,
    stackStyle,
    zoomPercent: Math.round((effectiveZoom / fitScale) * 100),
    stepZoom,
    resetFit,
    focusRect,
  };
}
