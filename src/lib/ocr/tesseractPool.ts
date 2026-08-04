import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js';
import { OCR_RENDER_SCALE } from '../pdf/constants';
import { ocrPoolSize, osdPoolSize } from '../concurrency';
import type { WordBox } from '../../types';
import { isFileProcessingCancelled, registerProcessingCancellationHandler } from '../processingCancellation';

export type Rotation = 0 | 90 | 180 | 270;

export interface OcrResult {
  text: string;
  boxes: WordBox[];
}

interface RecognizeOptions {
  /** Ratio of the rasterized image's size to the page's canonical (scale=1) reference frame —
   *  divided back out of returned word boxes so callers get coordinates in that canonical space,
   *  regardless of what resolution the image was actually rasterized at. Defaults to
   *  OCR_RENDER_SCALE, matching the PDF OCR path's fixed upscale. */
  scale?: number;
  fileId: string;
}

const POOL_SIZE = ocrPoolSize();

// --- Recognition pool: 'eng' only, default (LSTM-only) engine mode — unchanged from before OSD
// support existed. Orientation detection deliberately does NOT run on these workers or force
// them into a combined legacy+LSTM engine mode: eng.traineddata here is an LSTM-only model with
// no legacy tables, so forcing combined mode blends in a legacy pass with nothing valid to read,
// corrupting recognize() output — and doubles every recognize() call's work. See the separate OSD
// pool below instead. ---

interface Job {
  fileId: string;
  image: Blob;
  scale: number;
  attempts: number;
  resolve: (result: OcrResult) => void;
  reject: (err: unknown) => void;
}

const workerPromises: Array<Promise<TesseractWorker> | null> = new Array(POOL_SIZE).fill(null);
const busy: boolean[] = new Array(POOL_SIZE).fill(false);
const currentJobs: Array<Job | null> = new Array(POOL_SIZE).fill(null);
const queue: Job[] = [];

function getWorker(index: number): Promise<TesseractWorker> {
  if (!workerPromises[index]) {
    // Self-hosted so OCR never depends on a CDN — keeps processing fully offline/local.
    // Paths must be fully-qualified: the tesseract.js bootstrap worker runs from a blob: URL,
    // which cannot resolve root-relative paths via importScripts/fetch.
    const origin = window.location.origin;
    workerPromises[index] = createWorker('eng', undefined, {
      workerPath: `${origin}/tesseract/worker.min.js`,
      corePath: `${origin}/tesseract/core/`,
      langPath: `${origin}/tesseract/lang-data`,
    });
  }
  return workerPromises[index]!;
}

function invalidateWorker(index: number): void {
  const worker = workerPromises[index];
  workerPromises[index] = null;
  if (worker) void worker.then((instance) => instance.terminate()).catch(() => {});
}

async function pump(index: number): Promise<void> {
  if (busy[index]) return;
  const job = queue.shift();
  if (!job) return;
  if (isFileProcessingCancelled(job.fileId)) {
    job.reject(new Error('OCR cancelled.'));
    void pump(index);
    return;
  }
  busy[index] = true;
  currentJobs[index] = job;
  try {
    const worker = await getWorker(index);
    const { data } = await worker.recognize(job.image);
    // data.words is a flat array (added by tesseract.js's circularize() step), each with bbox in
    // the pixel space of the image actually fed to recognize() — normalize back to the page's
    // canonical (scale=1) reference frame by dividing out the raster's scale factor.
    const boxes: WordBox[] = data.words.map((word) => ({
      text: word.text,
      x0: word.bbox.x0 / job.scale,
      y0: word.bbox.y0 / job.scale,
      x1: word.bbox.x1 / job.scale,
      y1: word.bbox.y1 / job.scale,
    }));
    job.resolve({ text: boxes.map((b) => b.text).join(' '), boxes });
  } catch (err) {
    invalidateWorker(index);
    if (!isFileProcessingCancelled(job.fileId) && job.attempts < 1) {
      job.attempts++;
      queue.push(job);
    } else {
      job.reject(err);
    }
  } finally {
    busy[index] = false;
    currentJobs[index] = null;
    void pump(index);
  }
}

function dispatchAll(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    void pump(i);
  }
}

export function recognizeImage(image: Blob, opts: RecognizeOptions): Promise<OcrResult> {
  const scale = opts.scale ?? OCR_RENDER_SCALE;
  return new Promise((resolve, reject) => {
    queue.push({ fileId: opts.fileId, image, scale, attempts: 0, resolve, reject });
    dispatchAll();
  });
}

// --- Dedicated OSD (orientation) pool: separate, small, 'osd'-only workers using the Legacy
// engine (DetectOS is Legacy-engine functionality, and osd.traineddata is self-contained — it
// doesn't need 'eng' loaded alongside it). Kept fully apart from the recognition pool above so
// TIFF's rotation pre-check never touches PDF's or TIFF's own text-recognition quality/speed. ---

const OSD_POOL_SIZE = osdPoolSize();

// Tesseract's orientation_confidence isn't a 0-1 probability — below roughly this, its guess is
// no better than noise, so leave the page unrotated rather than "correcting" it incorrectly.
const MIN_ORIENTATION_CONFIDENCE = 1;

interface OsdJob {
  fileId: string;
  image: Blob;
  attempts: number;
  resolve: (rotation: Rotation) => void;
  reject: (err: unknown) => void;
}

const osdWorkerPromises: Array<Promise<TesseractWorker> | null> = new Array(OSD_POOL_SIZE).fill(null);
const osdBusy: boolean[] = new Array(OSD_POOL_SIZE).fill(false);
const currentOsdJobs: Array<OsdJob | null> = new Array(OSD_POOL_SIZE).fill(null);
const osdQueue: OsdJob[] = [];

function getOsdWorker(index: number): Promise<TesseractWorker> {
  if (!osdWorkerPromises[index]) {
    const origin = window.location.origin;
    osdWorkerPromises[index] = createWorker('osd', OEM.TESSERACT_ONLY, {
      workerPath: `${origin}/tesseract/worker.min.js`,
      corePath: `${origin}/tesseract/core/`,
      langPath: `${origin}/tesseract/lang-data`,
    });
  }
  return osdWorkerPromises[index]!;
}

function invalidateOsdWorker(index: number): void {
  const worker = osdWorkerPromises[index];
  osdWorkerPromises[index] = null;
  if (worker) void worker.then((instance) => instance.terminate()).catch(() => {});
}

async function osdPump(index: number): Promise<void> {
  if (osdBusy[index]) return;
  const job = osdQueue.shift();
  if (!job) return;
  if (isFileProcessingCancelled(job.fileId)) {
    job.reject(new Error('Orientation detection cancelled.'));
    void osdPump(index);
    return;
  }
  osdBusy[index] = true;
  currentOsdJobs[index] = job;
  try {
    const worker = await getOsdWorker(index);
    const { data } = await worker.detect(job.image);
    if (data.orientation_degrees == null || data.orientation_confidence == null) {
      job.resolve(0);
    } else {
      const normalized = ((data.orientation_degrees % 360) + 360) % 360;
      const rounded = (Math.round(normalized / 90) * 90) % 360; // guard against near-90 float noise
      job.resolve(rounded === 0 || data.orientation_confidence < MIN_ORIENTATION_CONFIDENCE ? 0 : (rounded as Rotation));
    }
  } catch (err) {
    invalidateOsdWorker(index);
    if (!isFileProcessingCancelled(job.fileId) && job.attempts < 1) {
      job.attempts++;
      osdQueue.push(job);
    } else {
      job.reject(err);
    }
  } finally {
    osdBusy[index] = false;
    currentOsdJobs[index] = null;
    void osdPump(index);
  }
}

function dispatchOsd(): void {
  for (let i = 0; i < OSD_POOL_SIZE; i++) {
    void osdPump(i);
  }
}

/** Detects the clockwise rotation needed to make the image's text upright (0 if already upright
 *  or detection wasn't confident enough to act on). Runs on the separate OSD pool above. */
export function detectRotation(image: Blob, fileId: string): Promise<Rotation> {
  return new Promise((resolve, reject) => {
    osdQueue.push({ fileId, image, attempts: 0, resolve, reject });
    dispatchOsd();
  });
}


registerProcessingCancellationHandler((fileId) => {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].fileId !== fileId) continue;
    queue.splice(i, 1)[0].reject(new Error('OCR cancelled.'));
  }
  for (let i = osdQueue.length - 1; i >= 0; i--) {
    if (osdQueue[i].fileId !== fileId) continue;
    osdQueue.splice(i, 1)[0].reject(new Error('Orientation detection cancelled.'));
  }
  for (let i = 0; i < currentJobs.length; i++) {
    if (currentJobs[i]?.fileId === fileId) invalidateWorker(i);
  }
  for (let i = 0; i < currentOsdJobs.length; i++) {
    if (currentOsdJobs[i]?.fileId === fileId) invalidateOsdWorker(i);
  }
});

/** Rotates an image clockwise by the given angle — apply the result of detectRotation() with
 *  this before recognizeImage(), so returned word boxes come back already in corrected space. */
export async function rotateImage(image: Blob, degrees: 90 | 180 | 270): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  const swapped = degrees === 90 || degrees === 270;
  const canvas = new OffscreenCanvas(swapped ? bitmap.height : bitmap.width, swapped ? bitmap.width : bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}
