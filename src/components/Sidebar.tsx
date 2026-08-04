import { useAppStore } from '../store/appStore';
import DropZone from './DropZone';
import FileRow from './FileRow';
import BatchWarningBanner from './BatchWarningBanner';
import ThemeToggle from './ThemeToggle';

export default function Sidebar({ width }: { width: number }) {
  const fileOrder = useAppStore((s) => s.fileOrder);
  // Selects a number rather than the whole `files` map, so the sidebar re-renders only when
  // the progress count actually changes — not on every page appended to every file.
  const settledCount = useAppStore((s) => {
    let n = 0;
    for (const id of s.fileOrder) {
      const status = s.files[id]?.status;
      if (status === 'done' || status === 'partial' || status === 'failed') n++;
    }
    return n;
  });

  const total = fileOrder.length;
  const percent = total === 0 ? 0 : Math.round((settledCount / total) * 100);

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar__header">
        <div>
          <p className="sidebar__wordmark">Fynder</p>
          <p className="sidebar__tagline">Batch PDF & doc search</p>
        </div>
        <ThemeToggle />
      </div>
      <DropZone />
      <BatchWarningBanner />
      {total === 0 ? (
        <div className="empty-step-area">
          <div className="empty-step">
            <div className="empty-step__badge">1</div>
            <div className="empty-step__title">Drop</div>
            <div className="empty-step__desc">Add PDFs or docs</div>
          </div>
        </div>
      ) : (
        <>
          <p className="sidebar__list-header">
            {total} FILE{total === 1 ? '' : 'S'} · {percent}%
          </p>
          <ul className="sidebar__list">
            {fileOrder.map((id) => (
              <FileRow key={id} fileId={id} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
