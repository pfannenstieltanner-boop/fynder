/// <reference lib="webworker" />
import * as UTIF from 'utif2';
import type { WorkerOutMessage } from './pdfExtractor.worker';
import { MAX_DOCUMENT_PAGES, isPageSizeAllowed } from '../lib/files/limits';

interface ProcessMessage {
  type: 'process';
  fileId: string;
  file: File;
}

// Scanned TIFFs are often already high-DPI; unlike PDF pages (rasterized up from a small
// "points" viewport), a TIFF frame can already be huge, so rasterizing every page always needs
// OCR (there's no text layer to check), and every page is clamped down to this size instead of
// being scaled up like the PDF path does.
const MAX_RASTER_DIMENSION = 3500;

self.onmessage = async (e: MessageEvent<ProcessMessage>) => {
  const { fileId, file } = e.data;
  try {
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (ifds.length > MAX_DOCUMENT_PAGES) throw new Error('page limit');
    post({ type: 'start', fileId, pageCount: ifds.length });
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      if (!isPageSizeAllowed(ifd.width, ifd.height)) throw new Error('page dimensions exceed safety limit');
      UTIF.decodeImage(buffer, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      const { width, height } = ifd;
      const longestSide = Math.max(width, height);
      const scale = longestSide > MAX_RASTER_DIMENSION ? MAX_RASTER_DIMENSION / longestSide : 1;
      const blob = await rasterize(rgba, width, height, scale);
      post({ type: 'ocr-needed', fileId, pageNumber: i + 1, blob, scale });
    }
    post({ type: 'done', fileId });
  } catch (err) {
    post({ type: 'error', fileId, message: describeError(err) });
  }
};

async function rasterize(rgba: Uint8Array, width: number, height: number, scale: number): Promise<Blob> {
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  const sourceCanvas = new OffscreenCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) throw new Error('Canvas 2D context unavailable.');
  sourceCtx.putImageData(imageData, 0, 0);

  if (scale === 1) {
    return sourceCanvas.convertToBlob({ type: 'image/png' });
  }
  const outCanvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('Canvas 2D context unavailable.');
  outCtx.drawImage(sourceCanvas, 0, 0, outCanvas.width, outCanvas.height);
  return outCanvas.convertToBlob({ type: 'image/png' });
}

function post(message: WorkerOutMessage): void {
  (self as unknown as Worker).postMessage(message);
}

function describeError(err: unknown): string {
  if (err instanceof Error && /limit|too large|dimensions/i.test(err.message)) {
    return 'TIFF exceeds the page-count or image-size safety limits.';
  }
  return 'Failed to parse TIFF: corrupt or unsupported file.';
}
