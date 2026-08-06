import { getFileType } from './fileTypes';
import type { DiscoveredFile, FolderRoot } from './discoveryTypes';

export const MAX_DISCOVERY_ENTRIES = 50_000;
const BATCH_SIZE = 100;

export interface DiscoverySummary {
  scannedCount: number;
  supportedCount: number;
  inaccessibleCount: number;
  truncated: boolean;
}

export async function discoverFiles(
  root: FolderRoot,
  options: {
    includeSubfolders: boolean;
    signal: AbortSignal;
    onBatch: (files: DiscoveredFile[], scannedCount: number) => void;
  },
): Promise<DiscoverySummary> {
  const pending: Array<{ handle: FileSystemDirectoryHandle; path: string }> = [
    { handle: root.handle, path: '' },
  ];
  let batch: DiscoveredFile[] = [];
  let scannedCount = 0;
  let supportedCount = 0;
  let inaccessibleCount = 0;
  let truncated = false;

  while (pending.length > 0) {
    if (options.signal.aborted) throw new DOMException('The scan was cancelled.', 'AbortError');
    const directory = pending.shift();
    if (!directory) break;
    try {
      for await (const entry of directory.handle.values()) {
        if (options.signal.aborted) throw new DOMException('The scan was cancelled.', 'AbortError');
        scannedCount++;
        if (scannedCount > MAX_DISCOVERY_ENTRIES) {
          truncated = true;
          pending.length = 0;
          break;
        }
        const relativePath = directory.path ? `${directory.path}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          if (options.includeSubfolders) {
            pending.push({ handle: entry as FileSystemDirectoryHandle, path: relativePath });
          }
          continue;
        }
        try {
          const handle = entry as FileSystemFileHandle;
          const file = await handle.getFile();
          const fileType = getFileType(file);
          if (!fileType) continue;
          batch.push({
            id: `${root.id}:${relativePath.toLocaleLowerCase()}`,
            rootId: root.id,
            rootName: root.name,
            name: file.name,
            relativePath,
            parentPath: directory.path,
            fileType,
            size: file.size,
            lastModified: file.lastModified,
            handle,
          });
          supportedCount++;
          if (batch.length >= BATCH_SIZE) {
            options.onBatch(batch, scannedCount);
            batch = [];
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        } catch {
          inaccessibleCount++;
        }
      }
    } catch (error) {
      if (options.signal.aborted) throw error;
      inaccessibleCount++;
    }
  }

  if (batch.length > 0) options.onBatch(batch, scannedCount);
  return { scannedCount, supportedCount, inaccessibleCount, truncated };
}
