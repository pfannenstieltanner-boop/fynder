import { ZOOM_STEP_PERCENT } from '../hooks/useZoomPan';

export default function ZoomToolbar({
  zoomPercent,
  disabled,
  onStep,
  onFit,
  pageInfo,
}: {
  zoomPercent: number;
  disabled: boolean;
  onStep: (deltaPercent: number) => void;
  onFit: () => void;
  /** Current/total page, for paginated previews (PDF, TIFF). Omit for single-page-flow previews
   *  (DOCX scrolls continuously and has no navigable "current page"). Hidden for 1-page files —
   *  there's nothing to locate. */
  pageInfo?: { current: number; total: number } | null;
}) {
  return (
    <div className="preview-toolbar">
      <button
        type="button"
        className="preview-toolbar__btn"
        onClick={() => onStep(-ZOOM_STEP_PERCENT)}
        disabled={disabled}
        aria-label="Zoom out"
      >
        –
      </button>
      <span className="preview-toolbar__readout">{zoomPercent}%</span>
      <button
        type="button"
        className="preview-toolbar__btn"
        onClick={() => onStep(ZOOM_STEP_PERCENT)}
        disabled={disabled}
        aria-label="Zoom in"
      >
        +
      </button>
      {pageInfo && pageInfo.total > 1 && (
        // Absolutely centered on the bar itself (not the gap between the zoom controls and Fit
        // width), so it stays put regardless of how wide either side is.
        <span className="preview-toolbar__page">
          Page {pageInfo.current} of {pageInfo.total}
        </span>
      )}
      <button type="button" className="preview-toolbar__fit" onClick={onFit}>
        Fit width
      </button>
    </div>
  );
}
