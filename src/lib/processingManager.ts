import { useAppStore } from '../store/appStore';
import { extractionPoolSize } from './concurrency';
import { processPlainText } from './text/plainTextExtractor';
import { getFileType } from './files/fileTypes';
import type { WorkerOutMessage } from '../workers/pdfExtractor.worker';
import type { DocxWorkerOutMessage } from '../workers/docxExtractor.worker';
import type { WordBox } from '../types';
import {
  isFileProcessingCancelled,
  prepareFileProcessing,
  registerProcessingCancellationHandler,
} from './processingCancellation';

interface QueueItem {
  fileId: string;
  file: File;
}

interface ExtractionPoolOptions {
  /** Runs OSD rotation detection/correction before OCR — for sources (TIFF) whose orientation
   *  isn't known ahead of time. Left off for PDF, whose pages are already upright. */
  detectRotation?: boolean;
  /** Used in the crash-recovery error message, e.g. "PDF" / "TIFF". */
  label: string;
}

class ExtractionPool {
  private workers: Worker[];
  private busy: boolean[];
  private currentFileId: Array<string | null>;
  private queue: QueueItem[] = [];
  private extractionDone = new Set<string>();
  private workerFactory: () => Worker;
  private detectRotation: boolean;
  private label: string;

  constructor(size: number, workerFactory: () => Worker, opts: ExtractionPoolOptions) {
    this.workerFactory = workerFactory;
    this.detectRotation = opts.detectRotation ?? false;
    this.label = opts.label;
    this.workers = Array.from({ length: size }, (_, i) => this.createWorker(i));
    this.busy = new Array(size).fill(false);
    this.currentFileId = new Array(size).fill(null);
    registerProcessingCancellationHandler((fileId) => this.cancel(fileId));
  }

  private createWorker(index: number): Worker {
    const worker = this.workerFactory();
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => this.handleMessage(index, e.data);
    worker.onerror = () => this.handleWorkerCrash(index);
    return worker;
  }

  private handleWorkerCrash(index: number): void {
    const fileId = this.currentFileId[index];
    if (fileId) {
      useAppStore.getState().markFileFailed(fileId, `Failed to process ${this.label}: an internal error occurred.`);
      this.extractionDone.delete(fileId);
    }
    this.replaceWorker(index);
    this.busy[index] = false;
    this.currentFileId[index] = null;
    this.dispatchAvailable();
  }

  private replaceWorker(index: number): void {
    const oldWorker = this.workers[index];
    oldWorker.onmessage = null;
    oldWorker.onerror = null;
    oldWorker.terminate();
    this.workers[index] = this.createWorker(index);
  }

  private cancel(fileId: string): void {
    this.queue = this.queue.filter((item) => item.fileId !== fileId);
    this.extractionDone.delete(fileId);
    for (let i = 0; i < this.currentFileId.length; i++) {
      if (this.currentFileId[i] !== fileId) continue;
      this.replaceWorker(i);
      this.busy[i] = false;
      this.currentFileId[i] = null;
    }
    this.dispatchAvailable();
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.dispatchAvailable();
  }

  private dispatchAvailable(): void {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busy[i]) continue;
      const item = this.queue.shift();
      if (!item) continue;
      if (isFileProcessingCancelled(item.fileId) || !useAppStore.getState().files[item.fileId]) {
        i--;
        continue;
      }
      this.busy[i] = true;
      this.currentFileId[i] = item.fileId;
      this.workers[i].postMessage({ type: 'process', fileId: item.fileId, file: item.file });
    }
  }

  private maybeFinishFile(fileId: string): void {
    if (!this.extractionDone.has(fileId)) return;
    const file = useAppStore.getState().files[fileId];
    if (!file) {
      this.extractionDone.delete(fileId);
      return;
    }
    if (file.pendingOcrCount === 0) {
      useAppStore.getState().markFileDone(fileId);
      this.extractionDone.delete(fileId);
    }
  }

  private handleMessage(workerIndex: number, msg: WorkerOutMessage): void {
    if (this.currentFileId[workerIndex] !== msg.fileId || isFileProcessingCancelled(msg.fileId)) return;
    const store = useAppStore.getState();
    switch (msg.type) {
      case 'start':
        store.startProcessing(msg.fileId, msg.pageCount);
        break;

      case 'page':
        store.appendPage(msg.fileId, {
          pageNumber: msg.pageNumber,
          text: msg.text,
          source: 'text',
          boxes: msg.boxes,
        });
        break;

      case 'ocr-needed':
        store.incrementPendingOcr(msg.fileId);
        void this.runOcr(msg.fileId, msg.pageNumber, msg.blob, msg.scale);
        break;

      case 'done':
        this.extractionDone.add(msg.fileId);
        this.busy[workerIndex] = false;
        this.currentFileId[workerIndex] = null;
        this.dispatchAvailable();
        this.maybeFinishFile(msg.fileId);
        break;

      case 'error':
        store.markFileFailed(msg.fileId, msg.message);
        this.busy[workerIndex] = false;
        this.currentFileId[workerIndex] = null;
        this.dispatchAvailable();
        break;
    }
  }

  private async runOcr(fileId: string, pageNumber: number, blob: Blob, scale?: number): Promise<void> {
    const store = useAppStore.getState();
    let text = '';
    let boxes: WordBox[] = [];
    let rotation: 0 | 90 | 180 | 270 = 0;
    try {
      // Loaded on demand so tesseract.js stays out of the initial bundle — by the time any
      // page needs OCR we're already well past first paint, and the extra module fetch is
      // negligible against recognition itself.
      const { recognizeImage, detectRotation, rotateImage } = await import('./ocr/tesseractPool');
      let image = blob;
      if (this.detectRotation) {
        rotation = await detectRotation(blob, fileId);
        if (rotation !== 0) image = await rotateImage(image, rotation);
      }
      if (isFileProcessingCancelled(fileId)) return;
      const result = await recognizeImage(image, { scale, fileId });
      if (isFileProcessingCancelled(fileId)) return;
      text = result.text;
      boxes = result.boxes;
      store.appendPage(fileId, { pageNumber, text, source: 'ocr', boxes, rotation });
    } catch {
      if (!isFileProcessingCancelled(fileId)) {
        store.recordPageFailure(fileId, `Page ${pageNumber} could not be read by OCR.`);
      }
      return;
    } finally {
      store.decrementPendingOcr(fileId);
      this.maybeFinishFile(fileId);
    }
  }
}

class DocxExtractionPool {
  private workers: Worker[];
  private busy: boolean[];
  private currentFileId: Array<string | null>;
  private queue: QueueItem[] = [];

  constructor(size: number) {
    this.workers = Array.from({ length: size }, (_, i) => this.createWorker(i));
    this.busy = new Array(size).fill(false);
    this.currentFileId = new Array(size).fill(null);
    registerProcessingCancellationHandler((fileId) => this.cancel(fileId));
  }

  private createWorker(index: number): Worker {
    const worker = new Worker(new URL('../workers/docxExtractor.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<DocxWorkerOutMessage>) => this.handleMessage(index, e.data);
    worker.onerror = () => this.handleWorkerCrash(index);
    return worker;
  }

  private handleWorkerCrash(index: number): void {
    const fileId = this.currentFileId[index];
    if (fileId) {
      useAppStore.getState().markFileFailed(fileId, 'Failed to process Word document: an internal error occurred.');
    }
    this.replaceWorker(index);
    this.busy[index] = false;
    this.currentFileId[index] = null;
    this.dispatchAvailable();
  }

  private replaceWorker(index: number): void {
    const oldWorker = this.workers[index];
    oldWorker.onmessage = null;
    oldWorker.onerror = null;
    oldWorker.terminate();
    this.workers[index] = this.createWorker(index);
  }

  private cancel(fileId: string): void {
    this.queue = this.queue.filter((item) => item.fileId !== fileId);
    for (let i = 0; i < this.currentFileId.length; i++) {
      if (this.currentFileId[i] !== fileId) continue;
      this.replaceWorker(i);
      this.busy[i] = false;
      this.currentFileId[i] = null;
    }
    this.dispatchAvailable();
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.dispatchAvailable();
  }

  private dispatchAvailable(): void {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busy[i]) continue;
      const item = this.queue.shift();
      if (!item) continue;
      if (isFileProcessingCancelled(item.fileId) || !useAppStore.getState().files[item.fileId]) {
        i--;
        continue;
      }
      this.busy[i] = true;
      this.currentFileId[i] = item.fileId;
      this.workers[i].postMessage({ type: 'process', fileId: item.fileId, file: item.file });
    }
  }

  private handleMessage(workerIndex: number, msg: DocxWorkerOutMessage): void {
    if (this.currentFileId[workerIndex] !== msg.fileId || isFileProcessingCancelled(msg.fileId)) return;
    const store = useAppStore.getState();
    if (msg.type === 'done') {
      store.startProcessing(msg.fileId, 1);
      store.appendPage(msg.fileId, { pageNumber: 1, text: msg.text, source: 'text', boxes: [] });
      store.markFileDone(msg.fileId);
    } else {
      store.markFileFailed(msg.fileId, msg.message);
    }
    this.busy[workerIndex] = false;
    this.currentFileId[workerIndex] = null;
    this.dispatchAvailable();
  }
}

let pdfPool: ExtractionPool | null = null;
let tiffPool: ExtractionPool | null = null;
let docxPool: DocxExtractionPool | null = null;

function getPdfPool(): ExtractionPool {
  if (!pdfPool) {
    pdfPool = new ExtractionPool(
      extractionPoolSize(),
      () => new Worker(new URL('../workers/pdfExtractor.worker.ts', import.meta.url), { type: 'module' }),
      { label: 'PDF' },
    );
  }
  return pdfPool;
}

function getTiffPool(): ExtractionPool {
  if (!tiffPool) {
    tiffPool = new ExtractionPool(
      extractionPoolSize(),
      () => new Worker(new URL('../workers/tiffExtractor.worker.ts', import.meta.url), { type: 'module' }),
      { label: 'TIFF', detectRotation: true },
    );
  }
  return tiffPool;
}

function getDocxPool(): DocxExtractionPool {
  if (!docxPool) docxPool = new DocxExtractionPool(extractionPoolSize());
  return docxPool;
}

export function processFiles(entries: Array<{ id: string; file: File }>): void {
  for (const entry of entries) {
    prepareFileProcessing(entry.id);
    const type = getFileType(entry.file);
    if (type === 'pdf') {
      getPdfPool().enqueue({ fileId: entry.id, file: entry.file });
    } else if (type === 'tiff') {
      getTiffPool().enqueue({ fileId: entry.id, file: entry.file });
    } else if (type === 'docx') {
      getDocxPool().enqueue({ fileId: entry.id, file: entry.file });
    } else if (type === 'text' || type === 'markdown') {
      void processPlainText(entry.id, entry.file);
    }
  }
}
