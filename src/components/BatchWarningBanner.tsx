import { useAppStore } from '../store/appStore';

const FILE_COUNT_THRESHOLD = 50;
const BYTES_THRESHOLD = 200 * 1024 * 1024;

export default function BatchWarningBanner() {
  const cumulativeFileCount = useAppStore((s) => s.cumulativeFileCount);
  const cumulativeBytes = useAppStore((s) => s.cumulativeBytes);
  const dismissed = useAppStore((s) => s.batchWarningDismissed);
  const dismissBatchWarning = useAppStore((s) => s.dismissBatchWarning);

  const overThreshold = cumulativeFileCount > FILE_COUNT_THRESHOLD || cumulativeBytes > BYTES_THRESHOLD;
  if (dismissed || !overThreshold) return null;

  const mb = (cumulativeBytes / (1024 * 1024)).toFixed(0);

  return (
    <div className="batch-warning">
      <span>
        You've added {cumulativeFileCount} files ({mb} MB) this session. Large batches — especially
        with scanned pages needing OCR — may take a while to process. You don't need to do anything;
        processing will continue in the background.
      </span>
      <button
        type="button"
        className="batch-warning__dismiss"
        aria-label="Dismiss"
        onClick={dismissBatchWarning}
      >
        ×
      </button>
    </div>
  );
}
