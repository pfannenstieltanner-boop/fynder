/**
 * Wiring layer for batch-edit jobs (Replace Text / Replace Images), running on the **main
 * thread** — not in a Worker pool.
 *
 * This was originally designed around a Worker pool (mirroring `ExtractionPool` in
 * `processingManager.ts`), but real-browser verification found that `DOMParser`/`XMLSerializer` —
 * which every module in this folder depends on via `xmlSerialization.ts` — throw
 * `ReferenceError: DOMParser is not defined` inside a dedicated Worker in this app's Chromium/
 * WebView2 runtime, even though they're always available on the main thread. That's a hard
 * platform constraint, not a bug to work around: unlike `pdfExtractor`/`tiffExtractor`/OCR, which
 * are genuinely CPU-heavy and must stay off the UI thread, a batch-edit job here is a regex/DOM
 * pass over a Word document's XML parts (typically tens of KB to a few MB) — running it on the
 * main thread for a deliberate, user-initiated "Start" click is not a responsiveness concern.
 * JSZip's own decompression cost is identical either way, since it was never DOM-dependent.
 */
import { useAppStore } from '../../../store/appStore';
import { loadDocxPackage } from './zipPackage';
import { replaceTextInPackage, type TextReplaceOptions } from './textReplace';
import { replaceImagesInPackage, type FitMode, type ImageReplaceSelection } from './imageReplace';

export interface ReplaceBatchFileInput {
  fileId: string;
  fileName: string;
  file: File;
}

function outputFileName(sourceName: string, suffix: string): string {
  const dot = sourceName.lastIndexOf('.');
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}${suffix}.docx`;
}

function failureMessage(error: unknown): string {
  return error instanceof Error && /safety limit/i.test(error.message)
    ? 'Word document exceeds the expanded-size safety limits.'
    : 'Failed to process Word document: corrupt or unsupported file.';
}

// Image-replace can throw its own specific, already-user-safe messages (the staleness guard, the
// zip-bomb guard) — those are passed through verbatim rather than flattened to the generic
// message, since they tell the user something actionable ("rescan and try again").
const KNOWN_SAFE_IMAGE_ERRORS = [/location changed/i, /safety limit/i];

function imageFailureMessage(error: unknown): string {
  if (error instanceof Error && KNOWN_SAFE_IMAGE_ERRORS.some((re) => re.test(error.message))) {
    return error.message;
  }
  return 'Failed to process Word document: corrupt or unsupported file.';
}

const cancelledBatches = new Set<string>();

async function runTextReplaceJob(jobId: string, file: File, options: TextReplaceOptions): Promise<void> {
  const store = useAppStore.getState();
  store.updateReplaceJobRunning(jobId);
  try {
    const pkg = await loadDocxPackage(file);
    const result = await replaceTextInPackage(pkg, options);
    if (result.matchCount === 0) {
      store.skipReplaceJob(jobId, 'No matches found.');
      return;
    }
    const blob = await pkg.finalize();
    store.completeReplaceJob(jobId, { resultBlob: blob, matchCount: result.matchCount });
  } catch (error) {
    store.failReplaceJob(jobId, failureMessage(error));
  }
}

export function startTextReplaceBatch(
  batchId: string,
  files: ReplaceBatchFileInput[],
  options: TextReplaceOptions,
): void {
  const jobs = files.map((f) => ({
    id: crypto.randomUUID(),
    sourceFileId: f.fileId,
    sourceFileName: f.fileName,
    kind: 'text' as const,
    outputFileName: outputFileName(f.fileName, '-replaced-text'),
  }));
  useAppStore.getState().startReplaceBatch(batchId, jobs);
  cancelledBatches.delete(batchId);

  // Sequential, not concurrent — this is main-thread work (see the module comment above), so
  // running several at once would just have the batch fight itself for the same thread with no
  // real throughput gain.
  void (async () => {
    for (let i = 0; i < files.length; i++) {
      if (cancelledBatches.has(batchId)) return;
      await runTextReplaceJob(jobs[i].id, files[i].file, options);
    }
  })();
}

export interface ImageReplaceBatchFileInput {
  fileId: string;
  fileName: string;
  file: File;
  /** Occurrences selected within this file — the same shared replacement image/fit mode applies
   *  to all of them (see ReplaceImagesModal.tsx). */
  selections: ImageReplaceSelection[];
}

export interface ImageReplaceBatchOptions {
  replacementBytes: Uint8Array;
  extension: string;
  contentType: string;
  imageWidth: number;
  imageHeight: number;
  fitMode: FitMode;
}

async function runImageReplaceJob(
  jobId: string,
  file: File,
  selections: ImageReplaceSelection[],
  options: ImageReplaceBatchOptions,
): Promise<void> {
  const store = useAppStore.getState();
  store.updateReplaceJobRunning(jobId);
  try {
    const pkg = await loadDocxPackage(file);
    const result = await replaceImagesInPackage(pkg, { selections, ...options });
    if (result.replacedCount === 0) {
      store.skipReplaceJob(jobId, 'No occurrences selected for this file.');
      return;
    }
    const blob = await pkg.finalize();
    store.completeReplaceJob(jobId, { resultBlob: blob, matchCount: result.replacedCount });
  } catch (error) {
    store.failReplaceJob(jobId, imageFailureMessage(error));
  }
}

export function startImageReplaceBatch(
  batchId: string,
  files: ImageReplaceBatchFileInput[],
  options: ImageReplaceBatchOptions,
): void {
  const jobs = files.map((f) => ({
    id: crypto.randomUUID(),
    sourceFileId: f.fileId,
    sourceFileName: f.fileName,
    kind: 'images' as const,
    outputFileName: outputFileName(f.fileName, '-replaced-images'),
  }));
  useAppStore.getState().startReplaceBatch(batchId, jobs);
  cancelledBatches.delete(batchId);

  void (async () => {
    for (let i = 0; i < files.length; i++) {
      if (cancelledBatches.has(batchId)) return;
      await runImageReplaceJob(jobs[i].id, files[i].file, files[i].selections, options);
    }
  })();
}

export function cancelReplaceBatch(batchId: string): void {
  cancelledBatches.add(batchId);
}
