const cancelledFileIds = new Set<string>();
const handlers = new Set<(fileId: string) => void>();
const MAX_REMEMBERED_CANCELLATIONS = 10_000;

export function prepareFileProcessing(fileId: string): void {
  cancelledFileIds.delete(fileId);
}

export function isFileProcessingCancelled(fileId: string): boolean {
  return cancelledFileIds.has(fileId);
}

export function cancelFileProcessing(fileId: string): void {
  cancelledFileIds.add(fileId);
  if (cancelledFileIds.size > MAX_REMEMBERED_CANCELLATIONS) {
    const oldest = cancelledFileIds.values().next().value;
    if (oldest !== undefined) cancelledFileIds.delete(oldest);
  }
  for (const handler of handlers) handler(fileId);
}

export function registerProcessingCancellationHandler(handler: (fileId: string) => void): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
