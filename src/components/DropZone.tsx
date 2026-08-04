import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { processFiles } from '../lib/processingManager';
import { setFile } from '../lib/pdf/fileCache';
import { isSupportedFile, getFileType, isLegacyDocFile } from '../lib/files/fileTypes';
import { MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_LIVE_FILES } from '../lib/files/limits';

const ACCEPT =
  '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,.markdown,text/markdown,.tif,.tiff,image/tiff';

export default function DropZone() {
  const addFiles = useAppStore((s) => s.addFiles);
  const liveFileCount = useAppStore((s) => s.fileOrder.length);
  const liveBytes = useAppStore((s) => s.fileOrder.reduce((sum, id) => sum + (s.files[id]?.size ?? 0), 0));
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [skippedDocCount, setSkippedDocCount] = useState(0);
  const [limitSkippedCount, setLimitSkippedCount] = useState(0);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const all = Array.from(fileList);
      const supported = all.filter(isSupportedFile);
      const unsupported = all.filter((f) => !isSupportedFile(f));
      setSkippedDocCount(unsupported.filter(isLegacyDocFile).length);
      setSkippedCount(unsupported.filter((f) => !isLegacyDocFile(f)).length);
      let nextCount = liveFileCount;
      let nextBytes = liveBytes;
      const accepted: File[] = [];
      let rejectedByLimit = 0;
      for (const file of supported) {
        if (
          file.size > MAX_FILE_BYTES ||
          nextCount >= MAX_LIVE_FILES ||
          nextBytes + file.size > MAX_BATCH_BYTES
        ) {
          rejectedByLimit++;
          continue;
        }
        accepted.push(file);
        nextCount++;
        nextBytes += file.size;
      }
      setLimitSkippedCount(rejectedByLimit);
      if (accepted.length > 0) {
        const records = addFiles(accepted);
        records.forEach((record, i) => {
          const recordType = getFileType(accepted[i]);
          if (recordType === 'pdf' || recordType === 'tiff' || recordType === 'docx') setFile(record.id, accepted[i]);
        });
        processFiles(records.map((record, i) => ({ id: record.id, file: accepted[i] })));
      }
    },
    [addFiles, liveBytes, liveFileCount],
  );

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
        handleFiles(e.dataTransfer.files);
      }}
    >
      <p className="sidebar__dropzone-text">Drag files or</p>
      <button type="button" className="sidebar__dropzone-link" onClick={() => inputRef.current?.click()}>
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
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
    </section>
  );
}
