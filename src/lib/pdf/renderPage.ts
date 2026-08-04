import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { getFile } from './fileCache';
import { registerPreviewCache } from '../previewCaches';
import { isPageSizeAllowed } from '../files/limits';

// The extraction worker sets its own copy of this — GlobalWorkerOptions is scoped per JS
// realm, so the main thread needs its own assignment to load pdf.js here too.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Parsed documents hold their page data worker-side and are expensive to keep around, so the
// cache is a small LRU rather than unbounded. Evicting one only costs a re-parse if the user
// comes back to it.
const MAX_CACHED_DOCS = 4;

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

registerPreviewCache((fileId) => evictDocument(fileId));

export function getDocumentForFile(fileId: string): Promise<PDFDocumentProxy> {
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
  const doc = file.arrayBuffer().then((data) => pdfjsLib.getDocument({ data }).promise);
  docCache.set(fileId, doc);

  while (docCache.size > MAX_CACHED_DOCS) {
    const oldest = docCache.keys().next().value;
    if (oldest === undefined) break;
    evictDocument(oldest);
  }
  return doc;
}

export function evictDocument(fileId: string): void {
  const doc = docCache.get(fileId);
  docCache.delete(fileId);
  if (doc) doc.then((d) => d.destroy()).catch(() => {});
}

export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const canonicalViewport = page.getViewport({ scale: 1 });
  if (!isPageSizeAllowed(canonicalViewport.width, canonicalViewport.height)) {
    throw new Error('This page is too large to preview safely.');
  }
  const viewport = page.getViewport({ scale });
  if (!isPageSizeAllowed(viewport.width, viewport.height)) {
    throw new Error('This page is too large to preview safely.');
  }
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  const task = page.render({ canvasContext: ctx, viewport });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  return { width: viewport.width, height: viewport.height };
}
