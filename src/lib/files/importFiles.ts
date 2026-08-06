import { useAppStore } from '../../store/appStore';
import type { ImportFileCandidate } from '../../types';
import { processFiles } from '../processingManager';
import { setFile } from '../pdf/fileCache';
import { getFileType, isLegacyDocFile, isSupportedFile } from './fileTypes';
import { MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_LIVE_FILES } from './limits';

export interface FileImportReport {
  addedCount: number;
  unsupportedCount: number;
  legacyDocCount: number;
  limitRejectedCount: number;
  duplicateCount: number;
}

// Name + size + lastModified, rather than full content, identifies "the same file" cheaply —
// no need to read potentially hundreds of MB just to compare candidates. This also catches the
// common real case of the same physical file reached through two different folders (e.g. a
// OneDrive-synced document living under more than one path), since a copy preserves mtime.
function fileSignature(name: string, size: number, lastModified: number): string {
  return `${name.toLocaleLowerCase()}::${size}::${lastModified}`;
}

export function importFiles(candidates: ImportFileCandidate[]): FileImportReport {
  const report: FileImportReport = {
    addedCount: 0,
    unsupportedCount: 0,
    legacyDocCount: 0,
    limitRejectedCount: 0,
    duplicateCount: 0,
  };
  if (candidates.length === 0) return report;

  const state = useAppStore.getState();
  let nextCount = state.fileOrder.length;
  let nextBytes = state.fileOrder.reduce((sum, id) => sum + (state.files[id]?.size ?? 0), 0);
  const accepted: ImportFileCandidate[] = [];
  // Seeded with everything already loaded, then grown as candidates are accepted — catches
  // duplicates against existing files and duplicates within this same batch alike.
  const seenSignatures = new Set<string>();
  for (const id of state.fileOrder) {
    const existing = state.files[id];
    if (existing) seenSignatures.add(fileSignature(existing.name, existing.size, existing.lastModified));
  }

  for (const candidate of candidates) {
    const { file } = candidate;
    if (!isSupportedFile(file)) {
      if (isLegacyDocFile(file)) report.legacyDocCount++;
      else report.unsupportedCount++;
      continue;
    }
    const signature = fileSignature(file.name, file.size, file.lastModified);
    if (seenSignatures.has(signature)) {
      report.duplicateCount++;
      continue;
    }
    if (
      file.size > MAX_FILE_BYTES ||
      nextCount >= MAX_LIVE_FILES ||
      nextBytes + file.size > MAX_BATCH_BYTES
    ) {
      report.limitRejectedCount++;
      continue;
    }
    seenSignatures.add(signature);
    accepted.push(candidate);
    nextCount++;
    nextBytes += file.size;
  }

  if (accepted.length === 0) return report;
  const records = useAppStore.getState().addFiles(accepted);
  records.forEach((record, index) => {
    const file = accepted[index].file;
    const recordType = getFileType(file);
    if (recordType === 'pdf' || recordType === 'tiff' || recordType === 'docx') {
      setFile(record.id, file);
    }
  });
  processFiles(records.map((record, index) => ({ id: record.id, file: accepted[index].file })));
  report.addedCount = records.length;
  return report;
}
