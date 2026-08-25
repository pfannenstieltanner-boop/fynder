import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { collectDescendantFileIds, type FolderNode as FolderNodeData } from '../lib/files/fileTree';
import type { FileRecord } from '../types';
import FileRow from './FileRow';

export interface InstanceLocation {
  pageNumber: number;
  matchIndex: number;
  totalMatches: number;
}

type IncludedAggregate = 'all' | 'none' | 'mixed';

function computeIncludedAggregate(files: Record<string, FileRecord>, fileIds: string[]): IncludedAggregate {
  let anyIncluded = false;
  let anyExcluded = false;
  for (const id of fileIds) {
    const file = files[id];
    if (!file) continue;
    if (file.includedInSearch) anyIncluded = true;
    else anyExcluded = true;
  }
  if (anyIncluded && anyExcluded) return 'mixed';
  return anyIncluded ? 'all' : 'none';
}

// Defined as a `const` (not a plain function declaration) specifically so the recursive
// `<FolderNode node={child} />` call below closes over this memoized binding rather than the raw,
// unmemoized function — the component's own name inside a `memo(function X() {...})` would refer
// to the inner, non-memoized function instead.
const FolderNode = memo(function FolderNode({
  node,
  instancesByFileId,
  searchActive,
}: {
  node: FolderNodeData;
  /** Where to jump to for each file that currently has search matches — keyed by file id, absent
   *  for files with none. Threaded down from Sidebar (which owns the one `useSearch()` call this
   *  whole tree needs) rather than each row subscribing to the search context itself. */
  instancesByFileId: Map<string, InstanceLocation>;
  /** Whether a search is currently running at all — distinguishes "0 files match" (render the
   *  rollup badge) from "no search" (don't), since both look identical from `instancesByFileId`
   *  alone. */
  searchActive: boolean;
}) {
  const collapsed = useAppStore((s) => !!s.collapsedFolders[node.key]);
  const toggleFolderExpanded = useAppStore((s) => s.toggleFolderExpanded);
  const setFilesIncluded = useAppStore((s) => s.setFilesIncluded);
  const removeFiles = useAppStore((s) => s.removeFiles);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Stable for the node's lifetime — the tree is rebuilt (new node identities) whenever files are
  // added or removed, which is the only time this list could actually change.
  const descendantFileIds = useMemo(() => collectDescendantFileIds(node), [node]);

  const aggregate = useAppStore((s) => computeIncludedAggregate(s.files, descendantFileIds));

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = aggregate === 'mixed';
  }, [aggregate]);

  // Rollup so a folder's match state is legible without expanding it — the whole point of this
  // feature is to replace manually opening every subfolder to see which files have hits.
  const matchStats = useMemo(() => {
    if (!searchActive) return null;
    let matchingFiles = 0;
    let totalMatches = 0;
    for (const id of descendantFileIds) {
      const instance = instancesByFileId.get(id);
      if (!instance) continue;
      matchingFiles++;
      totalMatches += instance.totalMatches;
    }
    return { matchingFiles, totalFiles: descendantFileIds.length, totalMatches };
  }, [searchActive, descendantFileIds, instancesByFileId]);

  return (
    <li className="folder-node">
      <div className="folder-node__row">
        <button
          type="button"
          className="folder-node__toggle"
          onClick={() => toggleFolderExpanded(node.key)}
          aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          aria-expanded={!collapsed}
        >
          <svg
            className={`folder-node__chevron${collapsed ? '' : ' folder-node__chevron--open'}`}
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
          >
            <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={checkboxRef}
          type="checkbox"
          className="file-row__checkbox"
          checked={aggregate === 'all'}
          onChange={() => setFilesIncluded(descendantFileIds, aggregate !== 'all')}
          aria-label={`${aggregate === 'all' ? 'Exclude' : 'Include'} all files in ${node.name} in search`}
        />
        <svg className="folder-node__icon" width="14" height="12" viewBox="0 0 16 14" aria-hidden="true">
          <path
            d="M1 2.5C1 1.67 1.67 1 2.5 1H6l1.5 2H13.5C14.33 3 15 3.67 15 4.5V11.5C15 12.33 14.33 13 13.5 13H2.5C1.67 13 1 12.33 1 11.5V2.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
        <span className="folder-node__name" title={node.name} onClick={() => toggleFolderExpanded(node.key)}>
          {node.name}
        </span>
        {matchStats && (
          <span
            className={`folder-node__match-badge${matchStats.matchingFiles === 0 ? ' folder-node__match-badge--none' : ''}`}
            title={`${matchStats.matchingFiles} of ${matchStats.totalFiles} files match · ${matchStats.totalMatches} total match${matchStats.totalMatches === 1 ? '' : 'es'}`}
          >
            {matchStats.matchingFiles}/{matchStats.totalFiles} · {matchStats.totalMatches}
          </span>
        )}
        <button
          type="button"
          className="folder-node__remove"
          aria-label={`Remove all files in ${node.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!confirmingRemove) {
              setConfirmingRemove(true);
              return;
            }
            removeFiles(descendantFileIds);
          }}
          onBlur={() => setConfirmingRemove(false)}
        >
          {confirmingRemove ? 'Are you sure?' : 'Remove?'}
        </button>
      </div>
      {!collapsed && (
        <ul className="folder-node__children">
          {node.children.map((child) => (
            <FolderNode key={child.key} node={child} instancesByFileId={instancesByFileId} searchActive={searchActive} />
          ))}
          {node.fileIds.map((id) => {
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
        </ul>
      )}
    </li>
  );
});

export default FolderNode;
