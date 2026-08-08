export const SNIPPET_RADIUS = 60;
// No cap on total matches retained/counted — a file's (and the whole search's) totalMatches is
// always its real count, and every match's position is kept (see FileSearchResult.matchesByPage).
// The results UI stays cheap regardless of how large that gets by paginating the flat match list
// (see RESULTS_PAGE_SIZE below) and building snippet text lazily, only for whichever page of
// *results* is currently shown — see OccurrenceList.
export const MAX_TOTAL_MATCHES = Infinity;
// How many match rows OccurrenceList shows at once. Replaces the old hard 50-match display cap —
// instead of truncating, matches beyond this are reachable via the pager at the bottom of the
// panel, in pages of this size.
export const RESULTS_PAGE_SIZE = 50;
