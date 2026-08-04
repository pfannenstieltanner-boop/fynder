import { useAppStore } from '../store/appStore';
import PreviewShell from './PreviewShell';

export default function PreviewPane({ width }: { width: number }) {
  const previewTarget = useAppStore((s) => s.previewTarget);
  const hasFiles = useAppStore((s) => s.fileOrder.length > 0);
  // Selects just the previewed record instead of the whole map, so unrelated files'
  // progress updates don't re-render the pane.
  const file = useAppStore((s) => (s.previewTarget ? s.files[s.previewTarget.fileId] ?? null : null));

  if (!hasFiles) {
    return (
      <div className="preview-pane preview-pane--empty" style={{ width }}>
        <div className="empty-step">
          <div className="empty-step__badge">3</div>
          <div className="empty-step__title">See</div>
          <div className="empty-step__desc">Preview opens here</div>
        </div>
      </div>
    );
  }

  if (!previewTarget || !file) {
    return (
      <div className="preview-pane preview-pane--empty" style={{ width }}>
        <p className="preview-pane__hint">Select a result to preview</p>
      </div>
    );
  }

  return <PreviewShell file={file} previewTarget={previewTarget} width={width} />;
}
