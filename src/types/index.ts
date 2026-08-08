export type FileStatus = 'queued' | 'processing' | 'done' | 'partial' | 'failed';
export type PageSource = 'text' | 'ocr';
export type SourceSummary = 'text' | 'ocr' | 'mixed' | 'unknown';
export type SearchMode = 'plain' | 'regex';
/** How multiple committed search terms combine — a file must contain every term ('all') or at
 *  least one ('any'). Only meaningful in plain mode; regex mode always has exactly one term. */
export type SearchTermsMode = 'any' | 'all';
export type FileType = 'pdf' | 'docx' | 'text' | 'markdown' | 'tiff';
export type Theme = 'dark' | 'light';

export interface FileSource {
  /** Unique per folder *pick*, not per real-world folder — generated fresh each time a root
   *  folder is chosen or dropped (see ChooseFilesModal's FolderRoot / DropZone's drop handler).
   *  This is what the file tree groups by, so two folders that happen to share a name (picked
   *  from different locations) render as separate trees instead of merging into one. It cannot
   *  be used to recognize "the same real folder added again in a later session" — the File
   *  System Access API exposes no stable path/identity across sessions, only rootName does
   *  (imprecisely), which is why saved source sets still match on rootName, not this. */
  rootId: string;
  rootName: string;
  relativePath: string;
}

export interface ImportFileCandidate {
  file: File;
  source?: FileSource;
}

export interface WordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageData {
  pageNumber: number;
  text: string;
  source: PageSource;
  boxes: WordBox[];
  /** Degrees the raster was rotated (clockwise) to correct its orientation before OCR, if detected. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  /** From the source File's own lastModified. Combined with name+size to detect duplicate
   *  imports without reading file contents — see importFiles.ts. */
  lastModified: number;
  fileType: FileType;
  status: FileStatus;
  error?: string;
  pageCount: number | null;
  pages: PageData[];
  processedPageCount: number;
  pendingOcrCount: number;
  failedPageCount: number;
  sourceSummary: SourceSummary;
  /** Whether this file's text is included when searching. Checked (true) by default; the
   *  sidebar checkbox toggles it per file. Purely a search-time filter — extraction/OCR still
   *  runs regardless, so re-checking a file surfaces results immediately. */
  includedInSearch: boolean;
  /** Present when a file was discovered under an explicitly authorized folder. */
  source?: FileSource;
}

export interface MatchSegment {
  text: string;
  highlight: boolean;
}

export interface MatchRange {
  start: number;
  end: number;
}

export interface ResultOccurrence {
  pageNumber: number;
  matchIndexInPage: number;
  segments: MatchSegment[];
}

export interface FileSearchResult {
  fileId: string;
  fileName: string;
  fileType: FileType;
  totalMatches: number;
  primarySnippet: MatchSegment[];
  /** Capped list for display — see occurrencesTruncated when totalMatches exceeds this list's length. */
  occurrences: ResultOccurrence[];
  occurrencesTruncated: boolean;
  matchesByPage: Record<number, MatchRange[]>;
}
