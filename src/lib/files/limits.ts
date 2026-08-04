export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_BATCH_BYTES = 200 * 1024 * 1024;
export const MAX_LIVE_FILES = 100;
export const MAX_DOCUMENT_PAGES = 2_000;
export const MAX_PAGE_PIXELS = 40_000_000;
export const MAX_PAGE_DIMENSION = 20_000;
export const MAX_DOCX_ENTRIES = 10_000;
export const MAX_DOCX_EXPANDED_BYTES = 250 * 1024 * 1024;

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

