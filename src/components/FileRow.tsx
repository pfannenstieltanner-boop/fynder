import { memo } from 'react';
import type { FileRecord } from '../types';
import { useAppStore } from '../store/appStore';

const TYPE_LABEL: Record<FileRecord['fileType'], string> = {
  pdf: 'PDF',
  docx: 'DOC',
  text: 'TXT',
  markdown: 'MD',
  tiff: 'TIFF',
};

const STATUS_TITLE: Record<FileRecord['status'], string> = {
  queued: 'Queued',
  processing: 'Processing…',
  done: 'Processed',
  partial: 'Processed with unreadable pages',
  failed: 'Failed',
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMeta(file: FileRecord): string {
  if (file.status === 'processing' && file.pageCount) {
    return `${file.processedPageCount}/${file.pageCount}`;
  }
  return formatSize(file.size);
}

// Takes only an id and selects its own record, so extracting a page from one file
// re-renders that file's row alone rather than every row in the list. `memo` stops the
// parent's own re-renders (progress percentage ticking over) from cascading here.
export default memo(function FileRow({ fileId }: { fileId: string }) {
  const file = useAppStore((s) => s.files[fileId]);
  const removeFile = useAppStore((s) => s.removeFile);
  const toggleFileIncluded = useAppStore((s) => s.toggleFileIncluded);
  if (!file) return null;

  const dotTitle = (file.status === 'failed' || file.status === 'partial') && file.error
    ? file.error
    : STATUS_TITLE[file.status];

  return (
    <li className="file-row">
      <input
        type="checkbox"
        className="file-row__checkbox"
        checked={file.includedInSearch}
        onChange={() => toggleFileIncluded(file.id)}
        aria-label={`${file.includedInSearch ? 'Exclude' : 'Include'} ${file.name} in search`}
      />
      <span className={`file-row__badge file-row__badge--${file.fileType}`}>{TYPE_LABEL[file.fileType]}</span>
      <span className="file-row__name" title={file.name}>
        {file.name}
      </span>
      <span className="file-row__meta">
        <span className="file-row__size">{formatMeta(file)}</span>
        <button
          type="button"
          className="file-row__remove"
          aria-label={`Remove ${file.name}`}
          onClick={(e) => {
            e.stopPropagation();
            removeFile(file.id);
          }}
        >
          Remove?
        </button>
        <span className={`file-row__dot file-row__dot--${file.status}`} title={dotTitle} />
      </span>
    </li>
  );
});
