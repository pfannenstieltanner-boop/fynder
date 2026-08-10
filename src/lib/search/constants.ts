// How far buildSnippet reaches around a match on each side. Deliberately generous — the row
// showing it (OccurrenceList) caps the *leading* side to a fixed word count regardless (see
// LEADING_WORD_COUNT in snippetFormatting.ts), so this constant's real job is making sure the
// *trailing* side has enough raw text to overflow the row and get genuinely clipped by CSS
// text-overflow: ellipsis at the actual right edge, rather than running out of source text first
// and stopping short with its own embedded "…" while leaving visible empty space in the row.
export const SNIPPET_RADIUS = 800;
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
