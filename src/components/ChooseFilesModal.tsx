import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/appStore';
import type { FileType, ImportFileCandidate } from '../types';
import { discoverFiles, type DiscoverySummary } from '../lib/files/directoryDiscovery';
import type { DiscoveredFile, DiscoveryFilters, FolderRoot, TermFilter } from '../lib/files/discoveryTypes';
import { filterDiscoveredFiles } from '../lib/files/filterDiscoveredFiles';
import { importFiles, type FileImportReport } from '../lib/files/importFiles';
import { loadSavedSourceSets, saveSourceSets, type SavedSourceSet } from '../lib/files/savedSourceSets';
import { MAX_LIVE_FILES } from '../lib/files/limits';

const ALL_TYPES: FileType[] = ['pdf', 'docx', 'tiff', 'text', 'markdown'];
const EMPTY_FILTERS: DiscoveryFilters = {
  folders: { terms: [], mode: 'any' },
  files: { terms: [], mode: 'any' },
  combineMode: 'both',
  fileTypes: ALL_TYPES,
  includeSubfolders: true,
};
const EMPTY_SUMMARY: DiscoverySummary = { scannedCount: 0, supportedCount: 0, inaccessibleCount: 0, truncated: false };
const DEFAULT_PICKER_HINT =
  "Pick as many folders as you like — the folder picker reopens after each one. Press Cancel in it when you're done.";

interface ScanAccumulator {
  results: DiscoveredFile[];
  summary: DiscoverySummary;
}

type ModalMode = 'folders' | 'individual';

function reportMessage(report: FileImportReport): string {
  const parts: string[] = [];
  if (report.addedCount) parts.push(`Added ${report.addedCount} file${report.addedCount === 1 ? '' : 's'}.`);
  if (report.unsupportedCount) parts.push(`Skipped ${report.unsupportedCount} unsupported file${report.unsupportedCount === 1 ? '' : 's'}.`);
  if (report.legacyDocCount) parts.push(`Skipped ${report.legacyDocCount} old-format .doc file${report.legacyDocCount === 1 ? '' : 's'}.`);
  if (report.limitRejectedCount) parts.push(`Skipped ${report.limitRejectedCount} file${report.limitRejectedCount === 1 ? '' : 's'} over session limits.`);
  if (report.duplicateCount) parts.push(`Skipped ${report.duplicateCount} file${report.duplicateCount === 1 ? '' : 's'} already loaded.`);
  return parts.join(' ');
}

function termKey(rootName: string, relativePath: string): string {
  return `${rootName.toLocaleLowerCase()}::${relativePath.toLocaleLowerCase()}`;
}

// Two callers need "the selected files with duplicate handles collapsed": addSelectedFiles (before
// importing) and saveCurrentSet (before recording which paths a saved set should re-select). Shared
// here so there's one place that walks isSameEntry() pairwise.
async function dedupeDiscovered(items: DiscoveredFile[]): Promise<DiscoveredFile[]> {
  const unique: DiscoveredFile[] = [];
  for (const item of items) {
    const duplicateChecks = await Promise.all(unique.map((existing) => existing.handle.isSameEntry(item.handle)));
    if (duplicateChecks.some(Boolean)) continue;
    unique.push(item);
  }
  return unique;
}

function buildSavedSet(
  name: string,
  roots: FolderRoot[],
  filters: DiscoveryFilters,
  selectedItems: DiscoveredFile[],
): SavedSourceSet {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    rootNames: roots.map((root) => root.name),
    filters,
    selectedRelativePaths: selectedItems.map((file) => termKey(file.rootName, file.relativePath)),
  };
}

function TermEditor({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: TermFilter;
  onChange: (value: TermFilter) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const additions = draft.split(',').map((term) => term.trim()).filter(Boolean);
    if (additions.length === 0) return;
    const normalized = new Set(value.terms.map((term) => term.toLocaleLowerCase()));
    onChange({ ...value, terms: [...value.terms, ...additions.filter((term) => !normalized.has(term.toLocaleLowerCase()))] });
    setDraft('');
  };

  return (
    <div className="file-discovery__field">
      <label className="file-discovery__label">
        {label} <span>(optional)</span>
      </label>
      <div className="file-discovery__term-box">
        {value.terms.map((term) => (
          <span className="file-discovery__term" key={term.toLocaleLowerCase()}>
            {term}
            <button
              type="button"
              aria-label={`Remove ${term}`}
              onClick={() => onChange({ ...value, terms: value.terms.filter((item) => item !== term) })}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={value.terms.length ? 'Add another' : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>
      <select
        className="file-discovery__select"
        aria-label={`${label} matching rule`}
        value={value.mode}
        onChange={(event) => onChange({ ...value, mode: event.target.value as TermFilter['mode'] })}
      >
        <option value="any">Match any term</option>
        <option value="all">Match all terms</option>
      </select>
    </div>
  );
}

export default function ChooseFilesModal({
  open,
  onClose,
  accept,
}: {
  open: boolean;
  onClose: () => void;
  accept: string;
}) {
  const [mode, setMode] = useState<ModalMode>('folders');
  const [roots, setRoots] = useState<FolderRoot[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<DiscoveryFilters>(EMPTY_FILTERS);
  const [scanning, setScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [summary, setSummary] = useState<DiscoverySummary | null>(null);
  const [message, setMessage] = useState('');
  const [savedSets, setSavedSets] = useState<SavedSourceSet[]>(loadSavedSourceSets);
  const [saveSet, setSaveSet] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [adding, setAdding] = useState(false);
  const [pendingPaths, setPendingPaths] = useState<Set<string> | null>(null);
  // How many roots need to be reconnected before `pendingPaths` is fully accounted for. Without
  // this, restoring a saved set spanning more than one root would only ever auto-select matches
  // from whichever root got reconnected first — matching was cleared after that single scan.
  const [pendingRootTarget, setPendingRootTarget] = useState<number | null>(null);
  // Live status for the folder-picking loop specifically (see chooseFolder) — surfaced right
  // next to the "Choose folder" button, since the generic `message` banner lower in the modal
  // is easy to miss in the instant between the OS dialog closing and reopening.
  const [pickerStatus, setPickerStatus] = useState(DEFAULT_PICKER_HINT);
  const abortRef = useRef<AbortController | null>(null);
  const directInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const liveFileCount = useAppStore((state) => state.fileOrder.length);
  const remainingCapacity = Math.max(0, MAX_LIVE_FILES - liveFileCount);
  const supportsDirectoryPicker = 'showDirectoryPicker' in window;

  const visibleFiles = useMemo(() => filterDiscoveredFiles(discovered, filters), [discovered, filters]);
  const visibleSelectedCount = visibleFiles.filter((file) => selectedIds.has(file.id)).length;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hidden);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!open) return null;

  // Scans exactly `rootsToScan` and folds the result onto `base` rather than starting over,
  // so adding one more folder to an existing set doesn't re-walk every folder already scanned.
  // Takes/returns an explicit accumulator instead of reading `discovered`/`summary` state, so a
  // caller can run this several times in a row (see chooseFolder's loop below) without each call
  // seeing a stale snapshot from before the previous one committed its state update.
  const scanRoots = async (rootsToScan: FolderRoot[], base: ScanAccumulator): Promise<ScanAccumulator> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    const results = [...base.results];
    let combined = base.summary;
    try {
      for (const root of rootsToScan) {
        const priorScanned = combined.scannedCount;
        const rootSummary = await discoverFiles(root, {
          includeSubfolders: filters.includeSubfolders,
          signal: controller.signal,
          onBatch: (batch, count) => {
            results.push(...batch);
            setDiscovered([...results]);
            setScannedCount(priorScanned + count);
          },
        });
        combined = {
          scannedCount: combined.scannedCount + rootSummary.scannedCount,
          supportedCount: combined.supportedCount + rootSummary.supportedCount,
          inaccessibleCount: combined.inaccessibleCount + rootSummary.inaccessibleCount,
          truncated: combined.truncated || rootSummary.truncated,
        };
      }
      setSummary(combined);
      setScannedCount(combined.scannedCount);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[Fynder] Folder scan failed:', error);
        setMessage('Fynder could not finish scanning the selected folders.');
      }
    } finally {
      if (abortRef.current === controller) setScanning(false);
    }
    return { results, summary: combined };
  };

  // Applies any pending saved-set selections against files discovered so far, and only clears
  // them once enough roots have been reconnected to account for the whole saved set — otherwise
  // reconnecting a second or third root after the first would no longer auto-select its matches.
  const applyPendingSelection = (results: DiscoveredFile[], totalRootsSoFar: number) => {
    if (!pendingPaths) return;
    const matched = results.filter((file) => pendingPaths.has(termKey(file.rootName, file.relativePath))).map((file) => file.id);
    if (matched.length > 0) setSelectedIds((prev) => new Set([...prev, ...matched]));
    if (totalRootsSoFar >= (pendingRootTarget ?? 0)) {
      setPendingPaths(null);
      setPendingRootTarget(null);
    }
  };

  const runScan = async (nextRoots = roots) => {
    setMessage('');
    setDiscovered([]);
    setSelectedIds(new Set());
    setScannedCount(0);
    setSummary(null);
    const accumulator = await scanRoots(nextRoots, { results: [], summary: EMPTY_SUMMARY });
    applyPendingSelection(accumulator.results, nextRoots.length);
  };

  // showDirectoryPicker() only ever returns one folder per call — no browser or OS exposes a
  // native multi-select folder dialog. Looping the prompt here is what lets a single click on
  // "Choose folder" add several folders: pick one, get scanned and added immediately, then the
  // picker reopens for the next. It stops as soon as the user cancels the dialog. `pickerStatus`
  // narrates each step so that second (and third, ...) dialog reads as expected rather than an
  // unexplained repeat popup.
  const chooseFolder = async () => {
    if (!supportsDirectoryPicker) return;
    let currentRoots = roots;
    let accumulator: ScanAccumulator = { results: discovered, summary: summary ?? EMPTY_SUMMARY };
    let addedCount = 0;
    for (;;) {
      let handle: FileSystemDirectoryHandle;
      try {
        // `id`/`startIn` would let the dialog avoid reopening inside whichever folder was
        // picked last, but that's tuning, not correctness — two consecutive bugs came from an
        // `id` value that turned out to be invalid, so it's left out entirely for now rather
        // than risk a third. The dialog will remember the last-picked folder as a result; that's
        // the browser's ordinary default behavior.
        handle = await window.showDirectoryPicker({ mode: 'read' });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[Fynder] showDirectoryPicker failed:', error instanceof DOMException ? `${error.name}: ${error.message}` : error);
          setMessage('Fynder could not access that folder.');
          setPickerStatus(DEFAULT_PICKER_HINT);
        } else if (addedCount > 0) {
          setPickerStatus(`Added ${addedCount} folder${addedCount === 1 ? '' : 's'}. Click "Choose folder" again anytime to add more.`);
        }
        return;
      }
      // Everything past this point used to sit outside any try/catch — any failure here (e.g.
      // isSameEntry rejecting) would throw out of the whole loop silently: no error message, and
      // whatever folder was just picked would never make it into `roots`.
      try {
        const duplicateChecks = await Promise.all(currentRoots.map((root) => root.handle.isSameEntry(handle)));
        if (duplicateChecks.some(Boolean)) {
          setPickerStatus(`"${handle.name}" is already selected — opening the folder picker again. Cancel it when you're done.`);
          continue;
        }
        const newRoot: FolderRoot = { id: crypto.randomUUID(), name: handle.name, handle };
        currentRoots = [...currentRoots, newRoot];
        addedCount++;
        setRoots(currentRoots);
        setPickerStatus(`Added "${handle.name}". Opening the folder picker again so you can add another — cancel it when you're done.`);
        accumulator = await scanRoots([newRoot], accumulator);
        applyPendingSelection(accumulator.results, currentRoots.length);
      } catch (error) {
        console.error('[Fynder] Failed to add picked folder:', error);
        setMessage(`Fynder could not add "${handle.name}".`);
        setPickerStatus(DEFAULT_PICKER_HINT);
        return;
      }
    }
  };

  const addSelectedFiles = async () => {
    setAdding(true);
    try {
      const selected = discovered.filter((file) => selectedIds.has(file.id)).slice(0, remainingCapacity);
      const uniqueItems = await dedupeDiscovered(selected);
      const candidates: ImportFileCandidate[] = [];
      let unavailable = 0;
      for (const item of uniqueItems) {
        try {
          candidates.push({
            file: await item.handle.getFile(),
            source: { rootName: item.rootName, relativePath: item.relativePath },
          });
        } catch {
          unavailable++;
        }
      }
      const report = importFiles(candidates);
      if (saveSet && saveName.trim()) {
        const saved = buildSavedSet(saveName.trim(), roots, filters, uniqueItems);
        const next = [...savedSets, saved];
        setSavedSets(next);
        saveSourceSets(next);
      }
      setMessage(`${reportMessage(report)}${unavailable ? ` ${unavailable} selected file${unavailable === 1 ? ' was' : 's were'} no longer available.` : ''}`.trim());
      if (report.addedCount > 0) onClose();
    } finally {
      setAdding(false);
    }
  };

  // Saves the current roots + filters (optionally with whatever's selected right now) without
  // adding anything to the working file list — for the case where the goal is "remember this
  // folder/filter combo to re-run later," not "I have files ready to import right now." Unlike
  // addSelectedFiles, this works with zero files selected (e.g. a freshly picked, still-empty
  // folder, or filters that don't currently match anything).
  const saveCurrentSet = async () => {
    const name = saveName.trim();
    if (!name || roots.length === 0) return;
    const selected = discovered.filter((file) => selectedIds.has(file.id));
    const uniqueItems = await dedupeDiscovered(selected);
    const saved = buildSavedSet(name, roots, filters, uniqueItems);
    const next = [...savedSets, saved];
    setSavedSets(next);
    saveSourceSets(next);
    setMessage(`Saved “${saved.name}”.`);
    setSaveSet(false);
    setSaveName('');
  };

  const loadSavedSet = (id: string) => {
    const saved = savedSets.find((set) => set.id === id);
    if (!saved) return;
    abortRef.current?.abort();
    setRoots([]);
    setDiscovered([]);
    setSelectedIds(new Set());
    setFilters(saved.filters);
    setPendingPaths(new Set(saved.selectedRelativePaths));
    setPendingRootTarget(saved.rootNames.length);
    setMessage(`Reconnect ${saved.rootNames.join(', ')} to rebuild “${saved.name}”.`);
  };

  return createPortal(
    <div className="file-discovery" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="file-discovery__dialog" role="dialog" aria-modal="true" aria-labelledby="choose-files-title">
        <header className="file-discovery__header">
          <div>
            <h2 id="choose-files-title">Choose files</h2>
            <p>Files stay on this device until you choose to add them.</p>
          </div>
          <button ref={closeButtonRef} type="button" className="file-discovery__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="file-discovery__mode" role="group" aria-label="File selection method">
          <button type="button" className={mode === 'folders' ? 'is-active' : ''} onClick={() => setMode('folders')}>Search folders</button>
          <button type="button" className={mode === 'individual' ? 'is-active' : ''} onClick={() => setMode('individual')}>Select individual files</button>
        </div>

        {mode === 'individual' ? (
          <div className="file-discovery__individual">
            <p>Select one or more supported documents from the standard browser picker.</p>
            <button type="button" className="file-discovery__primary" onClick={() => directInputRef.current?.click()}>Open file picker</button>
            <input
              ref={directInputRef}
              type="file"
              accept={accept}
              multiple
              hidden
              onChange={(event) => {
                const report = importFiles(Array.from(event.target.files ?? [], (file) => ({ file })));
                setMessage(reportMessage(report));
                event.target.value = '';
                if (report.addedCount > 0) onClose();
              }}
            />
          </div>
        ) : (
          <div className="file-discovery__body">
            {savedSets.length > 0 && (
              <label className="file-discovery__saved-picker">
                <span>Open a saved source set</span>
                <select defaultValue="" onChange={(event) => loadSavedSet(event.target.value)}>
                  <option value="" disabled>Choose a saved set</option>
                  {savedSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
                </select>
              </label>
            )}

            <section className="file-discovery__section">
              <h3><span>1</span> Choose where to look</h3>
              <div className="file-discovery__root-actions">
                <button type="button" onClick={() => void chooseFolder()} disabled={!supportsDirectoryPicker || scanning}>Choose folder</button>
                {roots.length > 0 && <button type="button" onClick={() => void runScan()} disabled={scanning}>Rescan</button>}
                {scanning && <button type="button" onClick={() => abortRef.current?.abort()}>Cancel scan</button>}
              </div>
              {supportsDirectoryPicker && <p className="file-discovery__message" role="status">{pickerStatus}</p>}
              {!supportsDirectoryPicker && <p className="file-discovery__warning">Recursive folder search is unavailable in this browser. Use individual file selection instead.</p>}
              {roots.map((root) => (
                <div className="file-discovery__root" key={root.id}>
                  <span>{root.name}</span>
                  <button type="button" onClick={() => {
                    setRoots((items) => {
                      const next = items.filter((item) => item.id !== root.id);
                      if (next.length === 0) setPickerStatus(DEFAULT_PICKER_HINT);
                      return next;
                    });
                    setDiscovered((items) => items.filter((item) => item.rootId !== root.id));
                    setSelectedIds((ids) => new Set([...ids].filter((id) => !id.startsWith(`${root.id}:`))));
                  }}>Remove</button>
                </div>
              ))}
              <label className="file-discovery__check">
                <input
                  type="checkbox"
                  checked={filters.includeSubfolders}
                  onChange={(event) => setFilters({ ...filters, includeSubfolders: event.target.checked })}
                />
                Include all subfolders
              </label>
              <p className="file-discovery__hint">Read-only access. Fynder reads names, paths, and basic file details locally.</p>
            </section>

            <section className="file-discovery__section">
              <h3><span>2</span> Narrow the results</h3>
              <div className="file-discovery__filters">
                <TermEditor label="Folder names" placeholder="Type a term, then Enter" value={filters.folders} onChange={(folders) => setFilters({ ...filters, folders })} />
                <TermEditor label="File names" placeholder="Type a term, then Enter" value={filters.files} onChange={(files) => setFilters({ ...filters, files })} />
              </div>
              <div className="file-discovery__filter-options">
                <label>
                  <span>Combine folder and file rules</span>
                  <select value={filters.combineMode} onChange={(event) => setFilters({ ...filters, combineMode: event.target.value as DiscoveryFilters['combineMode'] })}>
                    <option value="both">Match both</option>
                    <option value="either">Match either</option>
                  </select>
                </label>
                <fieldset>
                  <legend>File types</legend>
                  {ALL_TYPES.map((type) => (
                    <label key={type}>
                      <input
                        type="checkbox"
                        checked={filters.fileTypes.includes(type)}
                        onChange={(event) => setFilters({
                          ...filters,
                          fileTypes: event.target.checked
                            ? [...filters.fileTypes, type]
                            : filters.fileTypes.filter((item) => item !== type),
                        })}
                      />
                      {type.toUpperCase()}
                    </label>
                  ))}
                </fieldset>
              </div>
            </section>

            <section className="file-discovery__section file-discovery__results">
              <div className="file-discovery__results-heading">
                <h3><span>3</span> Review matching files</h3>
                {scanning ? (
                  <p className="file-discovery__scanning">
                    <span className="spinner" aria-hidden="true" />
                    Scanning… {scannedCount.toLocaleString()} entries checked
                  </p>
                ) : (
                  <p>{visibleFiles.length.toLocaleString()} matching files · {visibleSelectedCount} selected</p>
                )}
              </div>
              {summary && (summary.inaccessibleCount > 0 || summary.truncated) && (
                <p className="file-discovery__warning">
                  {summary.inaccessibleCount > 0 ? `${summary.inaccessibleCount} item${summary.inaccessibleCount === 1 ? '' : 's'} could not be read. ` : ''}
                  {summary.truncated ? 'The scan stopped at the safety limit.' : ''}
                </p>
              )}
              <div className="file-discovery__bulk">
                <button type="button" onClick={() => {
                  const next = new Set(selectedIds);
                  const openSlots = Math.max(0, remainingCapacity - next.size);
                  visibleFiles.filter((file) => !next.has(file.id)).slice(0, openSlots).forEach((file) => next.add(file.id));
                  setSelectedIds(next);
                }}>Select visible</button>
                <button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
                <span>{remainingCapacity} session slots available</span>
              </div>
              <div className="file-discovery__table-wrap">
                <table>
                  <thead><tr><th>Select</th><th>File</th><th>Type</th><th>Size</th></tr></thead>
                  <tbody>
                    {visibleFiles.slice(0, 500).map((file) => (
                      <tr key={file.id}>
                        <td><input type="checkbox" checked={selectedIds.has(file.id)} disabled={!selectedIds.has(file.id) && selectedIds.size >= remainingCapacity} onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) next.add(file.id); else next.delete(file.id);
                          setSelectedIds(next);
                        }} aria-label={`Select ${file.name}`} /></td>
                        <td>{file.name}<small>{file.rootName}/{file.relativePath}</small></td>
                        <td>{file.fileType.toUpperCase()}</td>
                        <td>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleFiles.length > 500 && <p className="file-discovery__hint">Showing the first 500 matches. Refine the filters to see a smaller set.</p>}
                {!scanning && roots.length > 0 && visibleFiles.length === 0 && <p className="file-discovery__empty">No supported files match these filters.</p>}
              </div>
            </section>
          </div>
        )}

        {message && <p className="file-discovery__message" role="status">{message}</p>}

        {mode === 'folders' && (
          <footer className="file-discovery__footer">
            <div className="file-discovery__save">
              <label className="file-discovery__check"><input type="checkbox" checked={saveSet} onChange={(event) => setSaveSet(event.target.checked)} />Save as a reusable source set</label>
              {saveSet && <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Source set name" aria-label="Source set name" />}
            </div>
            <div>
              <button type="button" onClick={onClose}>Cancel</button>
              {saveSet && selectedIds.size === 0 && (
                <button type="button" disabled={roots.length === 0 || !saveName.trim()} onClick={() => void saveCurrentSet()}>
                  Save set
                </button>
              )}
              <button
                type="button"
                className="file-discovery__primary"
                disabled={adding || selectedIds.size === 0 || (saveSet && !saveName.trim())}
                aria-busy={adding}
                onClick={() => void addSelectedFiles()}
              >
                {adding ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Adding files…
                  </>
                ) : (
                  `Add ${Math.min(selectedIds.size, remainingCapacity)} file${Math.min(selectedIds.size, remainingCapacity) === 1 ? '' : 's'}`
                )}
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
