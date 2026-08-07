import { useCallback, useState } from 'react';
import { importFiles } from '../lib/files/importFiles';
import ChooseFilesModal from './ChooseFilesModal';

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
// contains. Unsupported files are left in; importFiles() already filters those out the same way
// it does for a flat drag-and-drop, so a dropped folder behaves exactly like dropping its
// contents individually would.
async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    try {
      return [await readFileEntry(entry as FileSystemFileEntry)];
    } catch {
      return [];
    }
  }
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
    const nested = await Promise.all(children.map(collectFilesFromEntry));
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

  const handleFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const report = importFiles(files.map((file) => ({ file })));
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
          void Promise.all(entries.map(collectFilesFromEntry)).then((groups) => handleFiles(groups.flat()));
        } else {
          handleFiles(Array.from(e.dataTransfer.files));
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
