import * as UTIF from 'utif2';
import { getFile } from '../pdf/fileCache';
import { registerPreviewCache } from '../previewCaches';

interface TiffFrame {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface TiffDocument {
  frames: TiffFrame[];
}

// Decoded frames are raw RGBA — a multi-page scanned TIFF runs to hundreds of MB — so this
// cache is capped tighter than the PDF one.
const MAX_CACHED_DOCS = 2;

const docCache = new Map<string, Promise<TiffDocument>>();

registerPreviewCache((fileId) => evictTiffDocument(fileId));

export function getTiffDocument(fileId: string): Promise<TiffDocument> {
  const cached = docCache.get(fileId);
  if (cached) {
    // Re-insert to mark as most recently used.
    docCache.delete(fileId);
    docCache.set(fileId, cached);
    return cached;
  }

  const file = getFile(fileId);
  if (!file) {
    return Promise.reject(new Error('File is no longer available for preview.'));
  }
  const doc = file.arrayBuffer().then((buffer) => {
    const ifds = UTIF.decode(buffer);
    const frames = ifds.map((ifd) => {
      UTIF.decodeImage(buffer, ifd);
      return { width: ifd.width, height: ifd.height, rgba: UTIF.toRGBA8(ifd) };
    });
    return { frames };
  });
  docCache.set(fileId, doc);

  while (docCache.size > MAX_CACHED_DOCS) {
    const oldest = docCache.keys().next().value;
    if (oldest === undefined) break;
    docCache.delete(oldest);
  }
  return doc;
}

export function evictTiffDocument(fileId: string): void {
  docCache.delete(fileId);
}

// Draws the page's frame rotated into canonical (upright) orientation — the same rotation
// applied before OCR, so the displayed image matches the space the page's WordBoxes were
// computed in. No extra "scale" concept here (unlike the PDF path's PREVIEW_SCALE): a TIFF's
// native pixel resolution already *is* the canonical scale=1 reference frame.
export async function renderTiffPageToCanvas(
  doc: TiffDocument,
  pageNumber: number,
  rotation: 0 | 90 | 180 | 270,
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number }> {
  const frame = doc.frames[pageNumber - 1];
  if (!frame) throw new Error('Page not found.');

  const source = new OffscreenCanvas(frame.width, frame.height);
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('Canvas 2D context unavailable.');
  const imageData = new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height);
  sourceCtx.putImageData(imageData, 0, 0);

  const swapped = rotation === 90 || rotation === 270;
  const width = swapped ? frame.height : frame.width;
  const height = swapped ? frame.width : frame.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -frame.width / 2, -frame.height / 2);
  ctx.restore();
  return { width, height };
}
