import { useAppStore } from '../../store/appStore';
import { isFileProcessingCancelled } from '../processingCancellation';

export async function processPlainText(fileId: string, file: File): Promise<void> {
  const store = useAppStore.getState();
  store.startProcessing(fileId, 1);
  try {
    const text = await file.text();
    if (isFileProcessingCancelled(fileId)) return;
    store.appendPage(fileId, { pageNumber: 1, text, source: 'text', boxes: [] });
    store.markFileDone(fileId);
  } catch {
    store.markFileFailed(fileId, 'Failed to read this file.');
  }
}
