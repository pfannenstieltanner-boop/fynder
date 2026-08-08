import type { MatchRange } from '../../types';

export interface MatchLocation {
  pageNumber: number;
  matchIndexInPage: number;
}

function sortedPageNumbers(matchesByPage: Record<number, MatchRange[]>): number[] {
  return Object.keys(matchesByPage)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The very first match in reading order, or undefined if there are none. */
export function firstMatchLocation(matchesByPage: Record<number, MatchRange[]>): MatchLocation | undefined {
  const pageNumber = sortedPageNumbers(matchesByPage)[0];
  if (pageNumber === undefined) return undefined;
  return { pageNumber, matchIndexInPage: 0 };
}

/** Every match, in reading order — pages ascending, then matches within a page in the order
 *  they were found. Used for full keyboard/footer cycling instead of a capped display list, so
 *  navigation can always reach every instance regardless of how many there are. */
export function flattenMatchLocations(matchesByPage: Record<number, MatchRange[]>): MatchLocation[] {
  const locations: MatchLocation[] = [];
  for (const pageNumber of sortedPageNumbers(matchesByPage)) {
    matchesByPage[pageNumber].forEach((_, matchIndexInPage) => locations.push({ pageNumber, matchIndexInPage }));
  }
  return locations;
}
