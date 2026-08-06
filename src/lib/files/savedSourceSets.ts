import type { DiscoveryFilters } from './discoveryTypes';

const STORAGE_KEY = 'fynder:savedSourceSets';

export interface SavedSourceSet {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  rootNames: string[];
  filters: DiscoveryFilters;
  selectedRelativePaths: string[];
}

function isSavedSourceSet(value: unknown): value is SavedSourceSet {
  if (!value || typeof value !== 'object') return false;
  const set = value as Partial<SavedSourceSet>;
  return (
    set.version === 1 &&
    typeof set.id === 'string' &&
    typeof set.name === 'string' &&
    Array.isArray(set.rootNames) &&
    Array.isArray(set.selectedRelativePaths) &&
    !!set.filters
  );
}

export function loadSavedSourceSets(): SavedSourceSet[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedSourceSet) : [];
  } catch {
    return [];
  }
}

export function saveSourceSets(sets: SavedSourceSet[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  } catch {
    // Saved sets are a convenience; importing files still works when storage is unavailable.
  }
}
