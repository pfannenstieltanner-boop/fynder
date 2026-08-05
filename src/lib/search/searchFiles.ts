import { findMatches } from './findMatches';
import { buildSnippet } from './buildSnippets';
import { MAX_OCCURRENCES_PER_RESULT, MAX_TOTAL_MATCHES } from './constants';
import type {
  FileRecord,
  FileSearchResult,
  FileType,
  MatchRange,
  MatchSegment,
  ResultOccurrence,
  SearchMode,
} from '../../types';

export interface SearchableFile {
  id: string;
  name: string;
  fileType: FileType;
  status: FileRecord['status'];
  pages: Array<{ pageNumber: number; text: string }>;
}

export interface SearchOutcome {
  results: FileSearchResult[];
  totalMatches: number;
  truncated: boolean;
}

/**
 * Per-file scan cache.
 *
 * The store replaces its whole `files` map on every `appendPage`, so a naive recompute
 * re-scans every completed file each time any one file gains a page — O(files x pages)
 * over a batch. Each entry here is keyed on the file's `pages` array *identity*, which
 * changes precisely when that file's content changes, so appending to file A leaves the
 * cached scans of files B..Z intact.
 *
 * Entries also carry the query/mode they were computed under; a changed query invalidates
 * each entry as it's revisited. The map is pruned to the live file set on every call, so
 * it can't outgrow the number of loaded files.
 */
interface CacheEntry {
  pages: SearchableFile['pages'];
  query: string;
  mode: SearchMode;
  scan: FileScan | null;
}

interface FileScan {
  totalMatches: number;
  primarySnippet: MatchSegment[];
  occurrences: ResultOccurrence[];
  matchesByPage: Record<number, MatchRange[]>;
  truncated: boolean;
}

const cache = new Map<string, CacheEntry>();

// Every file is scanned against the same fixed ceiling regardless of what other files are
// included or in what order — a file's own match count must never depend on its neighbors'.
// (It previously did: a shrinking "remaining budget" was threaded in from the caller, so
// checking one more file could silently trim or drop another, already-shown file's matches.
// See searchFiles() below for where the *global* cap is enforced instead.)
function scanFile(file: SearchableFile, regex: RegExp): FileScan | null {
  const occurrences: ResultOccurrence[] = [];
  let primarySnippet: MatchSegment[] | null = null;
  let totalMatches = 0;
  const matchesByPage: Record<number, MatchRange[]> = {};
  let truncated = false;

  for (const page of file.pages) {
    const remaining = MAX_TOTAL_MATCHES - totalMatches;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const matches = findMatches(page.text, regex, remaining + 1);
    if (matches.length === 0) continue;

    const keptMatches = matches.length > remaining ? matches.slice(0, remaining) : matches;
    if (matches.length > keptMatches.length) truncated = true;
    if (keptMatches.length > 0) matchesByPage[page.pageNumber] = keptMatches;

    keptMatches.forEach((m, matchIndexInPage) => {
      if (!primarySnippet || occurrences.length < MAX_OCCURRENCES_PER_RESULT) {
        const segments = buildSnippet(page.text, m);
        if (!primarySnippet) primarySnippet = segments;
        if (occurrences.length < MAX_OCCURRENCES_PER_RESULT) {
          occurrences.push({ pageNumber: page.pageNumber, matchIndexInPage, segments });
        }
      }
    });

    totalMatches += keptMatches.length;
    if (truncated) break;
  }

  if (totalMatches === 0 || !primarySnippet) return null;
  return { totalMatches, primarySnippet, occurrences, matchesByPage, truncated };
}

export function searchFiles(
  files: Record<string, SearchableFile>,
  fileOrder: string[],
  query: string,
  mode: SearchMode,
  regex: RegExp,
): SearchOutcome {
  const results: FileSearchResult[] = [];
  let totalMatches = 0;
  let truncated = false;

  const live = new Set(fileOrder);
  for (const id of cache.keys()) {
    if (!live.has(id)) cache.delete(id);
  }

  for (const fileId of fileOrder) {
    const file = files[fileId];
    if (!file || (file.status !== 'done' && file.status !== 'partial')) continue;

    // The global cap is enforced here, at admission time, rather than by shrinking each file's
    // own scan — so a file's reported count never shifts depending on which other files are
    // included or in what order. Once the running total from files already shown reaches the
    // cap, no further files are added (this one and any after it), but everything already
    // included keeps its full, honest count.
    if (totalMatches >= MAX_TOTAL_MATCHES) {
      truncated = true;
      break;
    }

    const cached = cache.get(fileId);
    let scan: FileScan | null;
    if (cached && cached.pages === file.pages && cached.query === query && cached.mode === mode) {
      scan = cached.scan;
    } else {
      scan = scanFile(file, regex);
      cache.set(fileId, { pages: file.pages, query, mode, scan });
    }
    if (!scan) continue;

    results.push({
      fileId,
      fileName: file.name,
      fileType: file.fileType,
      totalMatches: scan.totalMatches,
      primarySnippet: scan.primarySnippet,
      occurrences: scan.occurrences,
      occurrencesTruncated: scan.totalMatches > scan.occurrences.length,
      matchesByPage: scan.matchesByPage,
    });
    totalMatches += scan.totalMatches;
    if (scan.truncated) {
      truncated = true;
      break;
    }
  }

  return { results, totalMatches, truncated };
}

/** Exposed for the store's file-removal path; scans are keyed per file. */
export function evictFileScan(fileId: string): void {
  cache.delete(fileId);
}
