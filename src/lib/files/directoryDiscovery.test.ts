import { describe, expect, it } from 'vitest';
import { discoverFiles } from './directoryDiscovery';
import type { FolderRoot } from './discoveryTypes';

function fileHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => ({ name, type: '', size: 20, lastModified: 1 }) as File,
  } as FileSystemFileHandle;
}

function directoryHandle(name: string, entries: FileSystemHandle[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) yield entry;
    },
  } as FileSystemDirectoryHandle;
}

describe('discoverFiles', () => {
  it('discovers supported files recursively and preserves relative paths', async () => {
    const nested = directoryHandle('Proposals', [fileHandle('Project.pdf'), fileHandle('ignore.exe')]);
    const handle = directoryHandle('Marketing', [fileHandle('Goal.docx'), nested]);
    const root: FolderRoot = { id: 'root', name: 'Marketing', handle };
    const found: string[] = [];
    const summary = await discoverFiles(root, {
      includeSubfolders: true,
      signal: new AbortController().signal,
      onBatch: (batch) => found.push(...batch.map((file) => file.relativePath)),
    });
    expect(found).toEqual(['Goal.docx', 'Proposals/Project.pdf']);
    expect(summary.supportedCount).toBe(2);
  });

  it('stays at the selected root when subfolders are disabled', async () => {
    const nested = directoryHandle('Proposals', [fileHandle('Project.pdf')]);
    const handle = directoryHandle('Marketing', [fileHandle('Goal.docx'), nested]);
    const found: string[] = [];
    await discoverFiles(
      { id: 'root', name: 'Marketing', handle },
      {
        includeSubfolders: false,
        signal: new AbortController().signal,
        onBatch: (batch) => found.push(...batch.map((file) => file.relativePath)),
      },
    );
    expect(found).toEqual(['Goal.docx']);
  });

  it('honors cancellation before enumeration', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(discoverFiles(
      { id: 'root', name: 'Marketing', handle: directoryHandle('Marketing', []) },
      { includeSubfolders: true, signal: controller.signal, onBatch: () => undefined },
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});
