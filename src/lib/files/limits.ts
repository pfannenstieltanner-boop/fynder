export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_BATCH_BYTES = 200 * 1024 * 1024;
export const MAX_LIVE_FILES = 100;
export const MAX_DOCUMENT_PAGES = 2_000;
// Governs OCR rasterization only (see pdfExtractor.worker.ts's rasterizePage). Tesseract
// processes every pixel it's given, so this stays conservative to bound OCR time/memory across
// a batch with several recognition workers running at once — unlike the preview budget below,
// it isn't about what a single on-screen canvas paint can safely handle.
export const MAX_PAGE_PIXELS = 40_000_000;
export const MAX_PAGE_DIMENSION = 20_000;
// The preview pane's own budget: a single one-off paint to a visible <canvas>, not a per-pixel
// CPU pass, so it can afford to be far more generous than the OCR limit above — large-format
// architectural/engineering sheets (ARCH E at 36"x48" and similar) routinely exceed 40M pixels
// once rasterized at PREVIEW_SCALE. MAX_PREVIEW_RASTER_DIMENSION instead reflects a real hard
// ceiling: common desktop GPU 2D canvas/texture size limits.
export const MAX_PREVIEW_RASTER_PIXELS = 150_000_000;
export const MAX_PREVIEW_RASTER_DIMENSION = 16_384;
export const MAX_DOCX_ENTRIES = 10_000;
export const MAX_DOCX_EXPANDED_BYTES = 250 * 1024 * 1024;
// One shared replacement image per batch (see ReplaceImagesModal) — generous enough for a
// full-resolution photo without letting an oversized file balloon a batch write.
export const MAX_REPLACEMENT_IMAGE_BYTES = 25 * 1024 * 1024;

/** Shared zip-bomb guard for any code that expands a DOCX's zip entries, read-only or writing. */
export function assertDocxSafeToExpand(entryCount: number, expandedBytes: number): void {
  if (entryCount > MAX_DOCX_ENTRIES || expandedBytes > MAX_DOCX_EXPANDED_BYTES) {
    throw new Error('Word document exceeds expanded-size safety limits.');
  }
}

export function isPageSizeAllowed(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_PAGE_DIMENSION &&
    height <= MAX_PAGE_DIMENSION &&
    width * height <= MAX_PAGE_PIXELS
  );
}

/**
 * Picks the largest scale up to `desiredScale` that keeps a `canonicalWidth`x`canonicalHeight`
 * (scale=1) page within the preview raster budget, instead of just refusing to render oversized
 * pages outright. Large sheets preview at reduced density rather than not at all — consistent
 * with the preview pane already being a single fixed-scale raster (see PdfPreview's own notes on
 * PREVIEW_SCALE) rather than something that re-rasterizes per zoom level.
 */
export function computeSafePreviewScale(canonicalWidth: number, canonicalHeight: number, desiredScale: number): number {
  if (!Number.isFinite(canonicalWidth) || !Number.isFinite(canonicalHeight) || canonicalWidth <= 0 || canonicalHeight <= 0) {
    return desiredScale;
  }
  const scaleForPixels = Math.sqrt(MAX_PREVIEW_RASTER_PIXELS / (canonicalWidth * canonicalHeight));
  const scaleForDimension = MAX_PREVIEW_RASTER_DIMENSION / Math.max(canonicalWidth, canonicalHeight);
  return Math.min(desiredScale, scaleForPixels, scaleForDimension);
}

