import { useCallback, useState } from 'react';
import { importFiles } from '../lib/files/importFiles';
import ChooseFilesModal from './ChooseFilesModal';

const ACCEPT =
  '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,.markdown,text/markdown,.tif,.tiff,image/tiff';

export default function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [skippedDocCount, setSkippedDocCount] = useState(0);
  const [limitSkippedCount, setLimitSkippedCount] = useState(0);
  const [duplicateSkippedCount, setDuplicateSkippedCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const report = importFiles(Array.from(fileList, (file) => ({ file })));
      setSkippedDocCount(report.legacyDocCount);
      setSkippedCount(report.unsupportedCount);
      setLimitSkippedCount(report.limitRejectedCount);
      setDuplicateSkippedCount(report.duplicateCount);
    },
    [],
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
