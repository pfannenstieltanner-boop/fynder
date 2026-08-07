import type { MatchRange, SearchMode, SearchTermsMode } from '../../types';
import type { SearchOutcome, SearchableFile } from './searchFiles';
import type { SearchWorkerRequest, SearchWorkerResponse } from '../../workers/search.worker';

const SEARCH_TIMEOUT_MS = 5_000;
let nextRequestId = 1;

interface WorkerTask<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function runWorkerTask<T>(request: SearchWorkerRequest, read: (response: SearchWorkerResponse) => T): WorkerTask<T> {
  const worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectTask: (reason: Error) => void = () => {};

  const cleanup = () => {
    worker.terminate();
    clearTimeout(timeout);
  };

  const promise = new Promise<T>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      if (event.data.id !== request.id || settled) return;
      settled = true;
      cleanup();
      if (event.data.type === 'error') reject(new Error(event.data.message));
      else resolve(read(event.data));
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('The search worker failed.'));
    };
    worker.postMessage(request);
  });

  const timeout = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectTask(new Error('Search took too long and was stopped. Refine the query or use a simpler pattern.'));
  }, SEARCH_TIMEOUT_MS);

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectTask(new Error('Search cancelled.'));
    },
  };
}

export function searchFilesInWorker(
  files: Record<string, SearchableFile>,
  fileOrder: string[],
  terms: string[],
  mode: SearchMode,
  combineMode: SearchTermsMode,
): WorkerTask<SearchOutcome> {
  const request: SearchWorkerRequest = {
    id: nextRequestId++,
    type: 'search-files',
    files,
    fileOrder,
    terms,
    mode,
    combineMode,
  };
  return runWorkerTask(request, (response) => {
    if (response.type !== 'search-result') throw new Error('Unexpected search response.');
    return response.outcome;
  });
}

export function findMatchesInWorker(
  text: string,
  terms: string[],
  mode: SearchMode,
  combineMode: SearchTermsMode,
  limit = 2_000,
): WorkerTask<MatchRange[]> {
  const request: SearchWorkerRequest = {
    id: nextRequestId++,
    type: 'find-matches',
    text,
    terms,
    mode,
    combineMode,
    limit,
  };
  return runWorkerTask(request, (response) => {
    if (response.type !== 'match-result') throw new Error('Unexpected match response.');
    return response.matches;
  });
}
