import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { useSearch } from '../contexts/SearchContext';
import { buildFileTree } from '../lib/files/fileTree';
import { firstMatchLocation } from '../lib/search/matchLocations';
import DropZone from './DropZone';
import FileRow from './FileRow';
import FolderNode, { type InstanceLocation } from './FolderNode';
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
  // Grouping into a folder tree needs each file's id/name/source — static fields set once at
  // import and never mutated afterward — but the only selector that can reach them is `s.files`
  // as a whole, which (unlike the narrow selectors elsewhere in this file) changes reference on
  // every page appended to any file. FileRow's own memoization is what keeps that from actually
  // re-rendering every row; this just rebuilds the (cheap, ≤MAX_LIVE_FILES-sized) tree structure
  // more often than strictly necessary.
  const files = useAppStore((s) => s.files);
  const tree = useMemo(() => buildFileTree(files, fileOrder), [files, fileOrder]);

  // Clicking a file in the tree jumps straight to its first search match — so the tree needs to
  // know, per file, whether it currently has any. Computed once here (the results list already
  // only lists files with at least one match) and threaded down as flat primitives per row, not
  // subscribed to independently in every FileRow — see FileRow's own note on why.
  const { results } = useSearch();
  const instancesByFileId = useMemo(() => {
    const map = new Map<string, InstanceLocation>();
    for (const result of results) {
      const first = firstMatchLocation(result.matchesByPage);
      if (first) map.set(result.fileId, { pageNumber: first.pageNumber, matchIndex: first.matchIndexInPage });
    }
    return map;
  }, [results]);

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
            {tree.otherFileIds.length > 0 && (
              <>
                <li className="sidebar__group-heading">Other Files</li>
                {tree.otherFileIds.map((id) => {
                  const instance = instancesByFileId.get(id);
                  return (
                    <FileRow
                      key={id}
                      fileId={id}
                      firstMatchPageNumber={instance?.pageNumber}
                      firstMatchIndex={instance?.matchIndex}
                    />
                  );
                })}
              </>
            )}
            {tree.roots.map((root) => (
              <FolderNode key={root.key} node={root} instancesByFileId={instancesByFileId} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
