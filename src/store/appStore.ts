import { create } from 'zustand';
import type {
  FileRecord,
  FileType,
  ImportFileCandidate,
  PageData,
  SearchMode,
  SearchTermsMode,
  SourceSummary,
  Theme,
} from '../types';
import { ALL_FILE_TYPES, getFileType } from '../lib/files/fileTypes';
import { deleteFile } from '../lib/pdf/fileCache';
import { evictPreviewCaches } from '../lib/previewCaches';
import { evictFileScan } from '../lib/search/searchFiles';
import { cancelFileProcessing } from '../lib/processingCancellation';

const PANE_STORAGE_KEY = 'fynder:paneWidths';
const SIDEBAR_MIN = 170;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 250;
const PREVIEW_MIN = 260;
const PREVIEW_MAX = 900;
const PREVIEW_DEFAULT = 400;
const THEME_STORAGE_KEY = 'fynder:theme';
const COLLAPSED_FOLDERS_KEY = 'fynder:collapsedFolders';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadPaneWidths(): { sidebarWidth: number; previewWidth: number } {
  try {
    const raw = localStorage.getItem(PANE_STORAGE_KEY);
    if (!raw) throw new Error('no stored value');
    const parsed = JSON.parse(raw) as { sidebarWidth?: number; previewWidth?: number };
    return {
      sidebarWidth: clamp(parsed.sidebarWidth ?? SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
      previewWidth: clamp(parsed.previewWidth ?? PREVIEW_DEFAULT, PREVIEW_MIN, PREVIEW_MAX),
    };
  } catch {
    return { sidebarWidth: SIDEBAR_DEFAULT, previewWidth: PREVIEW_DEFAULT };
  }
}

function savePaneWidths(sidebarWidth: number, previewWidth: number): void {
  try {
    localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify({ sidebarWidth, previewWidth }));
  } catch {
    // localStorage may be unavailable (private browsing, quota) — persistence is a nice-to-have.
  }
}

function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // localStorage may be unavailable (private browsing) — fall through to the default.
  }
  return 'dark';
}

function applyThemeToDocument(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable — persistence is a nice-to-have.
  }
}

// Keyed by folder path (see FolderNode's `key`), which is stable across a session and across
// sessions that happen to reuse the same folder names — not tied to any particular file's id, so
// collapse state naturally carries over if the same folder structure is loaded again later.
function loadCollapsedFolders(): Record<string, true> {
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    if (!raw) throw new Error('no stored value');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, true>;
    throw new Error('invalid stored value');
  } catch {
    return {};
  }
}

function saveCollapsedFolders(collapsed: Record<string, true>): void {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(collapsed));
  } catch {
    // localStorage may be unavailable — persistence is a nice-to-have.
  }
}

// Applied at module-load time (before the app renders) rather than in a React effect, so the
// correct theme is in place for the very first paint instead of flashing dark-then-light.
const initialTheme = loadTheme();
applyThemeToDocument(initialTheme);

interface AppStore {
  files: Record<string, FileRecord>;
  fileOrder: string[];
  /** The in-progress text in the search box — not yet committed as a term. Also doubles as the
   *  sole query in regex mode, where multi-term chips are disabled. */
  searchQuery: string;
  searchMode: SearchMode;
  /** Terms committed via Tab (plain mode only). Combined with `searchQuery` (if non-empty) to
   *  form the live query — see SearchContext — so results still update as the user types the
   *  next term, not only once they've pressed Tab. */
  searchTerms: string[];
  searchTermsMode: SearchTermsMode;
  /** Which file types are included in search. Defaults to every supported type — i.e. the "All"
   *  chip's state — rather than an empty array meaning "all," so an empty array unambiguously
   *  means the user deselected everything and should see zero results. */
  searchFileTypes: FileType[];
  cumulativeFileCount: number;
  cumulativeBytes: number;
  batchWarningDismissed: boolean;
  sidebarWidth: number;
  previewWidth: number;
  theme: Theme;
  /** Folders collapsed in the sidebar's file tree, keyed by FolderNode.key. Presence = collapsed;
   *  a folder not in here is expanded (the default for one just added). */
  collapsedFolders: Record<string, true>;
  addFiles: (files: ImportFileCandidate[]) => FileRecord[];
  removeFile: (fileId: string) => void;
  removeFiles: (fileIds: string[]) => void;
  setFilesIncluded: (fileIds: string[], included: boolean) => void;
  toggleFolderExpanded: (folderKey: string) => void;
  setSidebarWidth: (width: number) => void;
  setPreviewWidth: (width: number) => void;
  /** Call once at the end of a resize drag — see the setters below. */
  persistPaneWidths: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  dismissBatchWarning: () => void;
  startProcessing: (fileId: string, pageCount: number) => void;
  appendPage: (fileId: string, page: PageData) => void;
  incrementPendingOcr: (fileId: string) => void;
  decrementPendingOcr: (fileId: string) => void;
  recordPageFailure: (fileId: string, error: string) => void;
  markFileDone: (fileId: string) => void;
  markFileFailed: (fileId: string, error: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  /** Trims and moves the current `searchQuery` into `searchTerms` (deduped, case-insensitively),
   *  then clears the input for the next term. No-op if the trimmed query is empty. */
  commitSearchTerm: () => void;
  removeSearchTerm: (term: string) => void;
  setSearchTermsMode: (mode: SearchTermsMode) => void;
  toggleSearchFileType: (fileType: FileType) => void;
  setAllSearchFileTypes: () => void;
  toggleFileIncluded: (fileId: string) => void;
  previewTarget: { fileId: string; pageNumber: number; matchIndex: number } | null;
  openPreview: (fileId: string, pageNumber: number, matchIndex?: number) => void;
  closePreview: () => void;
}

function createFileRecord(candidate: ImportFileCandidate): FileRecord {
  const { file, source } = candidate;
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    // Callers are expected to have already filtered via isSupportedFile(); this fallback
    // only guards against a FileRecord ever ending up with an invalid fileType.
    fileType: getFileType(file) ?? 'text',
    status: 'queued',
    pageCount: null,
    pages: [],
    processedPageCount: 0,
    pendingOcrCount: 0,
    failedPageCount: 0,
    sourceSummary: 'unknown',
    includedInSearch: true,
    source,
  };
}

// Closes the open preview when a file-type chip change excludes the previewed file's type — the
// preview pane otherwise keeps showing a file that's now grayed out of the tree. Called with the
// *next* type selection, since this runs as part of the same set() that applies it.
function previewTargetAfterTypeChange(
  target: AppStore['previewTarget'],
  files: Record<string, FileRecord>,
  nextTypes: FileType[],
): AppStore['previewTarget'] {
  if (!target) return null;
  const file = files[target.fileId];
  if (file && !nextTypes.includes(file.fileType)) return null;
  return target;
}

function computeSourceSummary(pages: PageData[]): SourceSummary {
  if (pages.length === 0) return 'unknown';
  const hasText = pages.some((p) => p.source === 'text');
  const hasOcr = pages.some((p) => p.source === 'ocr');
  if (hasText && hasOcr) return 'mixed';
  return hasOcr ? 'ocr' : 'text';
}

function updateFile(
  files: Record<string, FileRecord>,
  fileId: string,
  patch: Partial<FileRecord>,
): Record<string, FileRecord> {
  const existing = files[fileId];
  if (!existing) return files;
  return { ...files, [fileId]: { ...existing, ...patch } };
}

const initialPaneWidths = loadPaneWidths();

export const useAppStore = create<AppStore>((set, get) => ({
  files: {},
  fileOrder: [],
  searchQuery: '',
  searchMode: 'plain',
  searchTerms: [],
  searchTermsMode: 'all',
  searchFileTypes: [...ALL_FILE_TYPES],
  cumulativeFileCount: 0,
  cumulativeBytes: 0,
  batchWarningDismissed: false,
  sidebarWidth: initialPaneWidths.sidebarWidth,
  previewWidth: initialPaneWidths.previewWidth,
  theme: initialTheme,
  collapsedFolders: loadCollapsedFolders(),
  previewTarget: null,

  addFiles: (incoming) => {
    const records = incoming.map(createFileRecord);
    set((state) => {
      const files = { ...state.files };
      for (const record of records) {
        files[record.id] = record;
      }
      return {
        files,
        fileOrder: [...state.fileOrder, ...records.map((r) => r.id)],
        cumulativeFileCount: state.cumulativeFileCount + records.length,
        cumulativeBytes: state.cumulativeBytes + records.reduce((sum, r) => sum + r.size, 0),
      };
    });
    return records;
  },

  dismissBatchWarning: () => set({ batchWarningDismissed: true }),

  startProcessing: (fileId, pageCount) => {
    set((state) => ({
      files: updateFile(state.files, fileId, { status: 'processing', pageCount }),
    }));
  },

  appendPage: (fileId, page) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      // Pages nearly always arrive in order; only OCR'd ones land late. Insert at the right
      // index rather than re-sorting the whole array on every single append, which made
      // building up a long document O(n^2 log n).
      const pages = existing.pages.slice();
      let i = pages.length;
      while (i > 0 && pages[i - 1].pageNumber > page.pageNumber) i--;
      pages.splice(i, 0, page);
      return {
        files: updateFile(state.files, fileId, {
          pages,
          processedPageCount: pages.length + existing.failedPageCount,
        }),
      };
    });
  },

  incrementPendingOcr: (fileId) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      return {
        files: updateFile(state.files, fileId, {
          pendingOcrCount: existing.pendingOcrCount + 1,
        }),
      };
    });
  },

  decrementPendingOcr: (fileId) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      return {
        files: updateFile(state.files, fileId, {
          pendingOcrCount: Math.max(0, existing.pendingOcrCount - 1),
        }),
      };
    });
  },

  recordPageFailure: (fileId, error) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      return {
        files: updateFile(state.files, fileId, {
          failedPageCount: existing.failedPageCount + 1,
          processedPageCount: existing.processedPageCount + 1,
          error,
        }),
      };
    });
  },

  markFileDone: (fileId) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      return {
        files: updateFile(state.files, fileId, {
          status: existing.failedPageCount > 0 ? 'partial' : 'done',
          sourceSummary: computeSourceSummary(existing.pages),
        }),
      };
    });
  },

  markFileFailed: (fileId, error) => {
    set((state) => ({
      files: updateFile(state.files, fileId, { status: 'failed', error }),
    }));
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),

  commitSearchTerm: () => {
    set((state) => {
      const trimmed = state.searchQuery.trim();
      if (!trimmed) return state;
      const alreadyPresent = state.searchTerms.some((term) => term.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
      return {
        searchTerms: alreadyPresent ? state.searchTerms : [...state.searchTerms, trimmed],
        searchQuery: '',
      };
    });
  },
  removeSearchTerm: (term) => {
    set((state) => ({ searchTerms: state.searchTerms.filter((existing) => existing !== term) }));
  },
  setSearchTermsMode: (mode) => set({ searchTermsMode: mode }),

  toggleSearchFileType: (fileType) => {
    set((state) => {
      // Coming from "All" (every type selected), picking one is a fresh, exclusive choice —
      // not one more toggle against the full set, which would just remove that type and leave
      // "everything except it" selected. Once the user is in a custom selection, further clicks
      // go back to normal multiselect toggling (add/remove), until removing the last selected
      // type would leave nothing selected, in which case it falls back to "All" rather than
      // silently searching zero files.
      const allSelected = state.searchFileTypes.length === ALL_FILE_TYPES.length;
      let searchFileTypes: FileType[];
      if (allSelected) {
        searchFileTypes = [fileType];
      } else if (state.searchFileTypes.includes(fileType)) {
        const next = state.searchFileTypes.filter((type) => type !== fileType);
        searchFileTypes = next.length > 0 ? next : [...ALL_FILE_TYPES];
      } else {
        searchFileTypes = [...state.searchFileTypes, fileType];
      }
      return {
        searchFileTypes,
        previewTarget: previewTargetAfterTypeChange(state.previewTarget, state.files, searchFileTypes),
      };
    });
  },
  setAllSearchFileTypes: () => set({ searchFileTypes: [...ALL_FILE_TYPES] }),

  toggleFileIncluded: (fileId) => {
    set((state) => {
      const existing = state.files[fileId];
      if (!existing) return state;
      return {
        files: updateFile(state.files, fileId, { includedInSearch: !existing.includedInSearch }),
      };
    });
  },

  // Sets (not toggles) every listed file to the same includedInSearch value in one update — the
  // file tree's folder checkbox needs "make everything underneath match this" rather than N
  // independent toggles, which could flip some files the wrong way if they didn't all start out
  // in the same state (the mixed/indeterminate case).
  setFilesIncluded: (fileIds, included) => {
    set((state) => {
      let files = state.files;
      let changed = false;
      for (const id of fileIds) {
        const existing = files[id];
        if (!existing || existing.includedInSearch === included) continue;
        if (!changed) {
          files = { ...files };
          changed = true;
        }
        files[id] = { ...existing, includedInSearch: included };
      }
      return changed ? { files } : state;
    });
  },

  removeFile: (fileId) => get().removeFiles([fileId]),

  // The folder tree's Remove button deletes every file nested under it at once — batched into a
  // single set() rather than looping removeFile(), which would otherwise re-filter fileOrder and
  // re-copy `files` once per file.
  removeFiles: (fileIds) => {
    for (const id of fileIds) {
      cancelFileProcessing(id);
      deleteFile(id);
      evictPreviewCaches(id);
      evictFileScan(id);
    }
    set((state) => {
      const idSet = new Set(fileIds);
      const files = { ...state.files };
      let removedAny = false;
      for (const id of fileIds) {
        if (id in files) {
          delete files[id];
          removedAny = true;
        }
      }
      if (!removedAny) return state;
      return {
        files,
        fileOrder: state.fileOrder.filter((id) => !idSet.has(id)),
        previewTarget: state.previewTarget && idSet.has(state.previewTarget.fileId) ? null : state.previewTarget,
      };
    });
  },

  // These fire on every mousemove of a resize drag, so they only touch state. Persistence is
  // a separate explicit call at drag end — a synchronous localStorage write (plus JSON encode)
  // at 60+Hz was a real source of drag jank.
  setSidebarWidth: (width) => set({ sidebarWidth: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) }),
  setPreviewWidth: (width) => set({ previewWidth: clamp(width, PREVIEW_MIN, PREVIEW_MAX) }),

  persistPaneWidths: () => {
    const { sidebarWidth, previewWidth } = get();
    savePaneWidths(sidebarWidth, previewWidth);
  },

  setTheme: (theme) => {
    applyThemeToDocument(theme);
    saveTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyThemeToDocument(next);
      saveTheme(next);
      return { theme: next };
    });
  },

  openPreview: (fileId, pageNumber, matchIndex = 0) => set({ previewTarget: { fileId, pageNumber, matchIndex } }),
  closePreview: () => set({ previewTarget: null }),

  toggleFolderExpanded: (folderKey) => {
    set((state) => {
      const next = { ...state.collapsedFolders };
      if (next[folderKey]) delete next[folderKey];
      else next[folderKey] = true;
      saveCollapsedFolders(next);
      return { collapsedFolders: next };
    });
  },
}));
