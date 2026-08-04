/// <reference lib="webworker" />
import mammoth from 'mammoth/mammoth.browser';
import JSZip from 'jszip';
import { MAX_DOCX_ENTRIES, MAX_DOCX_EXPANDED_BYTES } from '../lib/files/limits';

interface ProcessMessage {
  type: 'process';
  fileId: string;
  file: File;
}

export type DocxWorkerOutMessage =
  | { type: 'done'; fileId: string; text: string }
  | { type: 'error'; fileId: string; message: string };

self.onmessage = async (e: MessageEvent<ProcessMessage>) => {
  const { fileId, file } = e.data;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let entryCount = 0;
    let expandedBytes = 0;
    zip.forEach((_path, entry) => {
      entryCount++;
      const data = entry as typeof entry & { _data?: { uncompressedSize?: number } };
      expandedBytes += data._data?.uncompressedSize ?? 0;
    });
    if (entryCount > MAX_DOCX_ENTRIES || expandedBytes > MAX_DOCX_EXPANDED_BYTES) {
      throw new Error('Word document exceeds expanded-size safety limits.');
    }
    const result = await mammoth.extractRawText({ arrayBuffer });
    post({ type: 'done', fileId, text: result.value });
  } catch (error) {
    const message = error instanceof Error && /safety limit/i.test(error.message)
      ? 'Word document exceeds the expanded-size safety limits.'
      : 'Failed to parse Word document: corrupt or unsupported file.';
    post({ type: 'error', fileId, message });
  }
};

function post(message: DocxWorkerOutMessage): void {
  (self as unknown as Worker).postMessage(message);
}
