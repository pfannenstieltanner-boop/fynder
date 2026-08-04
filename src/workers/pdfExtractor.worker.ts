/// <reference lib="webworker" />
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { isPageTextSufficient, OCR_RENDER_SCALE } from '../lib/pdf/constants';
import type { WordBox } from '../types';
import { MAX_DOCUMENT_PAGES, isPageSizeAllowed } from '../lib/files/limits';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface CanvasAndContext {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

// pdf.js's default CanvasFactory calls `document.createElement('canvas')`, which throws
// in a Worker (no `document`). Needed for any page that goes through page.render() —
// i.e. OCR rasterization, and internally for images with soft masks/patterns.
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified');
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

interface ProcessMessage {
  type: 'process';
  fileId: string;
  file: File;
}

export type WorkerOutMessage =
  | { type: 'start'; fileId: string; pageCount: number }
  | { type: 'page'; fileId: string; pageNumber: number; text: string; boxes: WordBox[] }
  | { type: 'ocr-needed'; fileId: string; pageNumber: number; blob: Blob; scale?: number }
  | { type: 'done'; fileId: string }
  | { type: 'error'; fileId: string; message: string };

self.onmessage = async (e: MessageEvent<ProcessMessage>) => {
  const { fileId, file } = e.data;
  try {
    const data = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data, CanvasFactory: OffscreenCanvasFactory }).promise;
    try {
      if (doc.numPages > MAX_DOCUMENT_PAGES) throw new Error('page limit');
      post({ type: 'start', fileId, pageCount: doc.numPages });
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items as Array<TextItem | { str?: undefined }>;
        const text = items.map((item) => (item as TextItem).str ?? '').join(' ');

        if (isPageTextSufficient(text)) {
          const boxes = buildWordBoxes(page, items);
          post({ type: 'page', fileId, pageNumber, text, boxes });
        } else {
          const blob = await rasterizePage(page);
          post({ type: 'ocr-needed', fileId, pageNumber, blob });
        }
      }
      post({ type: 'done', fileId });
    } finally {
      await doc.destroy();
    }
  } catch (err) {
    post({ type: 'error', fileId, message: describeError(err) });
  }
};

function buildWordBoxes(page: PDFPageProxy, items: Array<TextItem | { str?: undefined }>): WordBox[] {
  const viewport = page.getViewport({ scale: 1 });
  return items.map((rawItem) => {
    const item = rawItem as TextItem;
    if (!item.str) {
      return { text: '', x0: 0, y0: 0, x1: 0, y1: 0 };
    }
    const x0 = item.transform[4];
    const y0 = item.transform[5];
    const rect = viewport.convertToViewportRectangle([x0, y0, x0 + item.width, y0 + item.height]);
    return {
      text: item.str,
      x0: Math.min(rect[0], rect[2]),
      y0: Math.min(rect[1], rect[3]),
      x1: Math.max(rect[0], rect[2]),
      y1: Math.max(rect[1], rect[3]),
    };
  });
}

async function rasterizePage(page: PDFPageProxy): Promise<Blob> {
  const canonicalViewport = page.getViewport({ scale: 1 });
  if (!isPageSizeAllowed(canonicalViewport.width, canonicalViewport.height)) {
    throw new Error('page dimensions exceed safety limit');
  }
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  if (!isPageSizeAllowed(viewport.width, viewport.height)) {
    throw new Error('OCR raster dimensions exceed safety limit');
  }
  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  return canvas.convertToBlob({ type: 'image/png' });
}

function post(message: WorkerOutMessage): void {
  (self as unknown as Worker).postMessage(message);
}

function describeError(err: unknown): string {
  if (err instanceof Error && /limit|too large|dimensions/i.test(err.message)) {
    return 'PDF exceeds the page-count or page-size safety limits.';
  }
  if (err instanceof Error && /password/i.test(err.message)) {
    return 'Password-protected PDF is not supported.';
  }
  return 'Failed to parse PDF: corrupt or unsupported file.';
}
