/**
 * Pool sizes derived from the machine's core count instead of fixed constants.
 *
 * The previous fixed sizes (2 + 2 + 2 extraction, 3 OCR, 2 OSD = up to 11 workers) oversubscribed
 * a 4-core laptop badly and left a 16-core workstation mostly idle. OCR gets the largest share
 * because it's the throughput bottleneck by a wide margin; extraction is comparatively brief and
 * partly I/O-bound, and OSD runs only for TIFF.
 */

function cores(): number {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return typeof n === 'number' && n > 0 ? n : 4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Recognition workers — the bottleneck, so it takes what's left after leaving the UI headroom. */
export function ocrPoolSize(): number {
  return clamp(cores() - 2, 2, 8);
}

/** PDF / TIFF / DOCX text extraction. */
export function extractionPoolSize(): number {
  return clamp(Math.round(cores() / 4), 1, 4);
}

/** TIFF orientation detection only. */
export function osdPoolSize(): number {
  return clamp(Math.round(cores() / 8), 1, 2);
}
