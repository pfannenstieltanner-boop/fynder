/// <reference lib="webworker" />
import { buildSearchRegex } from '../lib/search/buildRegex';
import { findMatches } from '../lib/search/findMatches';
import { searchFiles, type SearchOutcome, type SearchableFile } from '../lib/search/searchFiles';
import type { MatchRange, SearchMode } from '../types';

export type SearchWorkerRequest =
  | {
      id: number;
      type: 'search-files';
      files: Record<string, SearchableFile>;
      fileOrder: string[];
      query: string;
      mode: SearchMode;
    }
  | { id: number; type: 'find-matches'; text: string; query: string; mode: SearchMode; limit?: number };

export type SearchWorkerResponse =
  | { id: number; type: 'search-result'; outcome: SearchOutcome }
  | { id: number; type: 'match-result'; matches: MatchRange[] }
  | { id: number; type: 'error'; message: string };

self.onmessage = (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  const built = buildSearchRegex(request.query, request.mode);
  if ('error' in built) {
    post({ id: request.id, type: 'error', message: built.error || 'Invalid search pattern.' });
    return;
  }
  if (request.type === 'search-files') {
    post({
      id: request.id,
      type: 'search-result',
      outcome: searchFiles(request.files, request.fileOrder, request.query, request.mode, built.regex),
    });
  } else {
    post({
      id: request.id,
      type: 'match-result',
      matches: findMatches(request.text, built.regex, request.limit),
    });
  }
};

function post(message: SearchWorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

