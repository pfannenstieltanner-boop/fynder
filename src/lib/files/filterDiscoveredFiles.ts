import type { DiscoveredFile, DiscoveryFilters, TermFilter } from './discoveryTypes';

function matchesTerms(value: string, filter: TermFilter): boolean {
  const normalized = value.toLocaleLowerCase();
  const terms = [...new Set(filter.terms.map((term) => term.trim().toLocaleLowerCase()).filter(Boolean))];
  if (terms.length === 0) return true;
  return filter.mode === 'all'
    ? terms.every((term) => normalized.includes(term))
    : terms.some((term) => normalized.includes(term));
}

export function filterDiscoveredFiles(files: DiscoveredFile[], filters: DiscoveryFilters): DiscoveredFile[] {
  const hasFolderTerms = filters.folders.terms.some((term) => term.trim());
  const hasFileTerms = filters.files.terms.some((term) => term.trim());
  return files.filter((file) => {
    if (!filters.fileTypes.includes(file.fileType)) return false;
    const folderMatch = matchesTerms(file.parentPath, filters.folders);
    const fileMatch = matchesTerms(file.name, filters.files);
    if (hasFolderTerms && hasFileTerms) {
      return filters.combineMode === 'both' ? folderMatch && fileMatch : folderMatch || fileMatch;
    }
    if (hasFolderTerms) return folderMatch;
    if (hasFileTerms) return fileMatch;
    return true;
  });
}
