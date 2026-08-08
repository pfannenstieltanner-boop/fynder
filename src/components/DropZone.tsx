import { useCallback, useState } from 'react';
import { importFiles } from '../lib/files/importFiles';
import ChooseFilesModal from './ChooseFilesModal';
import type { ImportFileCandidate } from '../types';

const ACCEPT =
  '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,.markdown,text/markdown,.tif,.tiff,image/tiff';

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

// Chrome caps a single readEntries() call at ~100 results — it must be called repeatedly until
// it comes back empty to see every entry in a folder, not just the first page of them.
async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await readDirectoryEntries(reader);
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// Walks a dropped entry — a plain file, or a folder to recurse into — collecting every File it
// contains, tagged with the same {rootId, rootName, relativePath} shape the Choose-files folder
// search attaches, so a dropped folder shows up in the sidebar's file tree the same way. `rootId`
// is generated once, the moment recursion first enters a directory, so two folders dropped in the
// same or different gestures that happen to share a name still land as distinct tree roots.
// `rootName` (and `rootId`) stay null until that happens — a file dropped loose (not inside a
// folder) keeps no source at all, same as one added via the individual picker. Unsupported files
// are left in; importFiles() already filters those out the same way it does for a flat
// drag-and-drop, so a dropped folder behaves exactly like dropping its contents individually
// would, just grouped.
async function collectCandidatesFromEntry(
  entry: FileSystemEntry,
  rootId: string | null,
  rootName: string | null,
  relativePath: string,
): Promise<ImportFileCandidate[]> {
  if (entry.isFile) {
    try {
      const file = await readFileEntry(entry as FileSystemFileEntry);
      return [{ file, source: rootId && rootName ? { rootId, rootName, relativePath } : undefined }];
    } catch {
      return [];
    }
  }
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
    // Resolved once per directory, before recursing — crypto.randomUUID() inline inside the
    // .map() below would instead mint a *different* id for every child, since each child's call
    // would evaluate `rootId ?? crypto.randomUUID()` independently.
    const childRootId = rootId ?? crypto.randomUUID();
    const childRootName = rootName ?? entry.name;
    const nested = await Promise.all(
      children.map((child) =>
        collectCandidatesFromEntry(
          child,
          childRootId,
          childRootName,
          relativePath ? `${relativePath}/${child.name}` : child.name,
        ),
      ),
    );
    return nested.flat();
  }
  return [];
}

export default function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [skippedDocCount, setSkippedDocCount] = useState(0);
  const [limitSkippedCount, setLimitSkippedCount] = useState(0);
  const [duplicateSkippedCount, setDuplicateSkippedCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const handleFiles = useCallback((candidates: ImportFileCandidate[]) => {
    if (candidates.length === 0) return;
    const report = importFiles(candidates);
    setSkippedDocCount(report.legacyDocCount);
    setSkippedCount(report.unsupportedCount);
    setLimitSkippedCount(report.limitRejectedCount);
    setDuplicateSkippedCount(report.duplicateCount);
  }, []);

  return (
    <section
      className={`sidebar__dropzone${isDragOver ? ' sidebar__dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);

        // webkitGetAsEntry() must be called synchronously, within the drop handler, before any
        // await — the DataTransferItemList it comes from isn't guaranteed to stay valid past
        // this task. The FileSystemEntry objects it returns remain usable afterward, so the
        // actual (async) directory walk happens once these are already in hand.
        const items = e.dataTransfer.items;
        const entries = items
          ? Array.from(items)
              .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
              .filter((entry): entry is FileSystemEntry => entry !== null)
          : [];

        if (entries.length > 0) {
          void Promise.all(entries.map((entry) => collectCandidatesFromEntry(entry, null, null, ''))).then(
            (groups) => handleFiles(groups.flat()),
          );
        } else {
          handleFiles(Array.from(e.dataTransfer.files, (file) => ({ file })));
        }
      }}
    >
      <p className="sidebar__dropzone-text">Drag files or folders, or</p>
      <button type="button" className="sidebar__dropzone-link" onClick={() => setModalOpen(true)}>
        Choose files
      </button>
      <ChooseFilesModal open={modalOpen} onClose={() => setModalOpen(false)} accept={ACCEPT} />
      {skippedCount > 0 && (
        <p className="sidebar__dropzone-warning">
          Skipped {skippedCount} unsupported file{skippedCount === 1 ? '' : 's'}.
        </p>
      )}
      {skippedDocCount > 0 && (
        <p className="sidebar__dropzone-warning">
          Skipped {skippedDocCount} old-format .doc file{skippedDocCount === 1 ? '' : 's'} — save as .docx first.
        </p>
      )}
      {limitSkippedCount > 0 && (
        <p className="sidebar__dropzone-warning">
          Skipped {limitSkippedCount} file{limitSkippedCount === 1 ? '' : 's'} over the safety limits
          (100 MB per file, 200 MB or 100 files loaded).
        </p>
      )}
      {duplicateSkippedCount > 0 && (
        <p className="sidebar__dropzone-warning">
          Skipped {duplicateSkippedCount} file{duplicateSkippedCount === 1 ? '' : 's'} already loaded.
        </p>
      )}
    </section>
  );
}
