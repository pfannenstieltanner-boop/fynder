# Fynder Session Handoff — 2026-08-08

## Purpose

This covers a single continuous session of feature work on top of the recursive
file-discovery feature documented in `HANDOFF.md` (2026-08-05, already merged). That
earlier handoff is still accurate for the Choose-files modal / folder-search workflow
and isn't repeated here. This document covers everything built *after* it, in the
order it was built, so another agent can pick up context without replaying the whole
conversation.

Two commits already landed this session:

```text
3cbec6f Add recursive folder-search import; fix search flicker and preview highlight bugs
1167241 Add file-type search chips, multi-term search, drag-and-drop folders, and instance cycling
```

Everything from "Folder tree view in the sidebar" onward (see below) is **uncommitted**
in the working tree as of this handoff — see "Working-tree status" at the end.

## Feature-by-feature summary

### 1. Loading animations

A shared CSS-only spinner (`.spinner`, `@keyframes spinner-rotate` in
`src/styles/global.css`, respects `prefers-reduced-motion`) was added to three
previously-plain-text loading states:

- PDF/TIFF/DOCX preview panes' "Rendering…" text (`PdfPreview.tsx`, `TiffPreview.tsx`,
  `DocxPreview.tsx`).
- The Choose-files modal's "Scanning… N entries checked" text
  (`ChooseFilesModal.tsx`).
- The modal's "Add N files" button also gained an `adding` state: while
  `addSelectedFiles()` is running (reading files off disk, importing, optionally
  saving a source set), the button disables, shows the spinner, and reads "Adding
  files…".

### 2. Save a source set without selecting any files

Previously, saving a reusable source set (see `HANDOFF.md`) required clicking "Add N
files" with at least one file checked — you couldn't save just a folder+filter combo
for later, with nothing currently selected. `ChooseFilesModal.tsx` now has a separate
`saveCurrentSet()` action and a "Save set" button, enabled whenever at least one root
folder has been added and a name is typed, independent of the file selection. Shared
`buildSavedSet()`/`dedupeDiscovered()` helpers factor out what used to be inlined only
in `addSelectedFiles()`.

### 3. File-type search chips

New row under the search bar in `ResultsColumn.tsx`: an "All" chip plus one chip per
supported file type (`ALL_FILE_TYPES`/`FILE_TYPE_LABELS`, now centralized in
`src/lib/files/fileTypes.ts` — `ChooseFilesModal.tsx`'s own type list should probably
be pointed at the same constant if it isn't already; check before adding a new file
type anywhere).

Store: `appStore.ts` gained `searchFileTypes: FileType[]` (defaults to all types),
`toggleSearchFileType`, `setAllSearchFileTypes`. `SearchContext.tsx` filters
`searchableFiles` by this before anything is searched.

**Selection semantics** (this took a couple of iterations — read carefully before
touching `toggleSearchFileType`):

- Default: every type selected, "All" chip shown active, every individual chip shown
  **muted** (not individually active — they're included via "All", not by choice).
- Clicking a specific type while "All" is active makes an **exclusive** selection —
  `searchFileTypes` becomes `[thatType]` only, not "all types minus one". "All" chip
  becomes muted.
- From a custom (non-"All") selection, further clicks toggle normally (add/remove).
  Removing the last selected type falls back to "All" rather than leaving zero types
  selected (which would silently return zero results with no visible cause).
- The sidebar file tree grays out (`file-row--type-excluded`, opacity 0.45) any file
  whose type isn't in the current selection — visible but deemphasized, still loaded
  and removable, just not searched.
- If the currently-open preview's file's type becomes excluded, the preview closes
  (`previewTargetAfterTypeChange()` in `appStore.ts`, run inside the same `set()` call
  that changes `searchFileTypes`).

### 4. Multi-term search (Tab to add a term)

`ResultsColumn.tsx`'s search box is now a token input in plain mode: type a term,
press **Tab** to commit it as a removable chip (`.search-term-chip`) and clear the
input for the next one. An **Any/All** toggle (`term-combine-toggle`) appears once at
least one term is committed, controlling whether a file must contain every term or
just one.

- Store: `searchTerms: string[]`, `searchTermsMode: 'any' | 'all'`,
  `commitSearchTerm()`, `removeSearchTerm()`, `setSearchTermsMode()`.
- `SearchContext.tsx` computes the *effective* term list as committed terms + the
  in-progress draft (deduped case-insensitively), so results still update live while
  typing the next term, not only after Tab.
- **Regex mode has no chips** — deliberately. One regex can already express any
  combination, and combining two independent features (regex + multi-term) was judged
  not worth the complexity. Regex mode just uses the raw input text as a single
  pattern, same as before this feature existed.
- Search internals (`buildSearchRegex`, `searchFiles`, the search worker,
  `searchWorkerClient`) were changed from a single `query: string` to
  `terms: string[]` + a `combineMode`. `buildSearchRegex` returns both a combined
  "any" regex (used for finding/highlighting every match regardless of combine mode)
  and per-term regexes (used only for the "all" mode admission check — a file must
  match every term regex *somewhere* to be admitted at all; scanning/highlighting
  itself always uses the combined regex once a file qualifies).
- `DocxPreview.tsx` independently re-derives its own matches against the rendered DOM
  (see `HANDOFF.md`'s note on why) — it now reads `terms`/`combineMode` from
  `useSearch()` instead of `query`/`mode`, so its matching stays consistent with the
  results list.

### 5. Drag-and-drop folder support

`DropZone.tsx` previously only accepted loose files on drop. It now reads dropped
items via `DataTransferItem.webkitGetAsEntry()` (called synchronously in the drop
handler, before any `await` — the item list isn't guaranteed valid past that task) and
recursively walks any `FileSystemDirectoryEntry` via `createReader().readEntries()`
(paged — Chrome caps ~100 entries per call, so it loops until empty). Falls back to
the flat `e.dataTransfer.files` path if `webkitGetAsEntry` isn't available.

Collected files get the same `{rootId, rootName, relativePath}` source metadata the
Choose-files folder search attaches (see #7 below for why `rootId` exists) — `rootId`
is minted once per top-level dropped folder via `crypto.randomUUID()`, generated
**once per directory, before recursing into its children** (a bug caught during
review: generating it inline inside the child `.map()` call would mint a different
random id per child instead of one shared id for the whole folder). A file dropped
loose (not inside a folder) gets no source at all, same as one added via the
individual file picker.

### 6. Enter-key instance cycling + auto-expand

In `PreviewShell.tsx`, pressing **Enter** while a preview is open advances to the next
match occurrence in the results list ("Instance list"); once the current file's last
shown occurrence is reached, it rolls into the next file's first occurrence, wrapping
back to the first file after the last.

This went through two real bugs worth knowing about if you touch this code:

1. **First version did nothing.** The listener was on the bubble phase, but each
   result card / occurrence row is a `role="button"` div with its own Enter handler
   that calls `stopPropagation()`. Fixed by registering on the **capture** phase
   (`document.addEventListener('keydown', handleKeyDown, true)`), which runs before
   the row's own handler gets a chance to stop it.
2. **Second version only advanced once.** An early guard tried to distinguish "focus
   is on the currently-active row" from "focus is on some other row the user tabbed
   to" (via a `data-preview-active` marker), to avoid hijacking genuine
   keyboard-navigate-to-a-different-row Enter presses. But after the first Enter moved
   `previewTarget` elsewhere, DOM focus doesn't move with it (React keeps the same
   node), so that row's "am I active" check went false and blocked every subsequent
   press. **Removed that guard entirely** — Enter now always cycles regardless of
   which row has focus, as long as focus isn't on an actual `input`/`textarea`/
   `select`/`button`/`contenteditable`. Tradeoff: tabbing to a specific
   not-yet-selected occurrence row and pressing Enter now cycles from wherever's
   currently open instead of selecting that row directly — Space still selects it
   directly, so keyboard accessibility isn't fully lost, just moved off Enter
   specifically.

`ResultCard.tsx` auto-expands (`useEffect` keyed on the `isSelected` transition, not
every render — so a user can still manually collapse an already-selected card without
it snapping back open) whenever a card *becomes* the selected file, whether via Enter
cycling, the preview footer's Prev/Next file buttons, or (see #9 below) clicking the
file in the sidebar tree.

### 7. Auto-zoom-to-match backed off

`useZoomPan.ts`'s `focusRect()` (the zoom that fires when you land on a search match)
previously always zoomed to `TARGET_MATCH_HEIGHT_PX` (32px). It now targets
`TARGET_MATCH_HEIGHT_PX * FOCUS_ZOOM_MULTIPLIER` where `FOCUS_ZOOM_MULTIPLIER = 2/3` —
about a third less aggressive. If this is wrong (product intent was ambiguous — "try
about 1/3 of the current zoom level" could mean either "reduce by a third" or "reduce
to a third"; this implements the former), it's a one-constant change.

### 8. Folder tree view in the sidebar

Previously the sidebar (`Sidebar.tsx`) rendered a flat `<ul>` of every loaded file.
It now groups files matching their real folder structure — see the "How this was
workshopped" note below, since a lot of the design intent lives in that Q&A rather
than in code comments.

**New files:**

- `src/lib/files/fileTree.ts` — pure `buildFileTree(files, fileOrder): FileTree`
  builds a nested `FolderNode` tree (folders before files, alphabetical at every
  level) from each file's `source`. Files with no `source` (individual picker, loose
  drops) go into `FileTree.otherFileIds` instead — not a folder, nothing to nest them
  under. `collectDescendantFileIds(node)` flattens a folder and everything nested
  under it. Has its own test file (`fileTree.test.ts`) — 3 tests, including a
  regression test for #9 below.
- `src/components/FolderNode.tsx` — new recursive component. Chevron to
  expand/collapse (state persisted to `localStorage` under `fynder:collapsedFolders`,
  same pattern as theme/pane widths — collapsed folders are the ones stored; a folder
  not in the set is expanded by default), a tri-state checkbox (indeterminate via a
  ref + `useEffect`, since React has no `indeterminate` prop; checked = every
  descendant file included in search, click sets all descendants to match), and a
  Remove button that swaps to "Are you sure?" on first click and bulk-removes every
  file nested underneath on the second (resets on blur if you click away instead of
  confirming). Defined as `const FolderNode = memo(function FolderNode(...) {...})` —
  the recursive `<FolderNode>` call inside its own body closes over this outer `const`
  binding rather than the raw unmemoized inner function, which is what makes the
  recursion still benefit from `memo()`.

**Store additions** (`appStore.ts`): `collapsedFolders: Record<string, true>` (+
persistence helpers), `toggleFolderExpanded`, `setFilesIncluded(fileIds, included)`
(bulk *set*, not toggle — needed because a mixed/indeterminate folder's checkbox click
needs "make everything match this," not N independent toggles that could flip some
files the wrong way), `removeFiles(fileIds)` (batched — one `set()` call instead of
looping `removeFile()`, which would re-copy `files`/re-filter `fileOrder` once per
file). `removeFile(fileId)` now just delegates to `removeFiles([fileId])`.

**Known, deliberate perf tradeoff:** building the tree requires `Sidebar.tsx` to
select the *whole* `s.files` map (grouping needs every file's `source`/`name`), which
changes reference on every page appended to any file — normally avoided in this
codebase (see `FileRow`'s own comment on why it selects narrowly). Accepted here
because `MAX_LIVE_FILES = 100` bounds the actual tree-rebuild cost to something
trivial; `FileRow`'s own `memo()` still stops the expensive per-row DOM from
re-rendering unnecessarily, since intermediate re-renders from a new `files` reference
only redo cheap JS (building the tree structure), not touch the DOM for rows whose own
props didn't change.

### 9. Unique root ids (fixing a same-named-folder collision)

Originally the tree grouped root-level folders by **name** (`FileSource.rootName`)
alone. This meant two different folders that happened to share a name — e.g.
"Documents" picked from two different locations — would silently merge their files
into one tree node. Flagged as a known limitation, then fixed on request since the
user confirmed this would happen in real usage.

Fix: `FileSource` (in `types/index.ts`) gained a `rootId: string` field — **unique per
folder *pick*, not per real-world folder**, minted fresh every time a root folder is
chosen or dropped:

- `ChooseFilesModal.tsx` already tracked a `rootId` per `DiscoveredFile` internally
  (used for its own duplicate-folder-pick check); it now also gets threaded into the
  `ImportFileCandidate.source` it builds.
- `DropZone.tsx`'s recursive drop-entry walker mints one via `crypto.randomUUID()`
  the moment it first enters a directory (see the "generate once per directory, not
  per file" note in #5 above — same bug class applies here too, and was avoided the
  same way).
- `fileTree.ts` groups root nodes by `rootId`, not `rootName` (subfolder nodes were
  never actually affected by this — see below).

**Read this before "fixing" a perceived remaining name-collision bug:** genuine
sibling subfolders sharing a name inside one real folder pick (e.g. `Root/A/Docs` and
`Root/B/Docs`) were *never* actually broken — `getOrCreateChild()` only matches a name
among the *same parent's* existing children, and an OS can't have two identically
named folders side by side in one real directory anyway. The only real gap was at the
root level (independently-picked folders), which `rootId` fixes.

**Known tradeoff, accepted deliberately:** because `rootId` is fresh per pick, if a
user re-picks the *exact same* physical folder in a later, separate session
(reopening the Choose-files modal, or a second drop), it now shows as a *second* root
node with the same display name, rather than merging into the existing one. File-level
duplicate detection (name + size + `lastModified`, in `importFiles.ts`) still prevents
any actual duplicate file from being re-added, so this is purely cosmetic (two tree
nodes instead of one), not a data-integrity issue. There is no fix available for this
without a stable cross-session folder identity, which the File System Access API does
not expose (no real paths, no persistent handles across page loads without explicit
IndexedDB-backed re-grant flows — see `HANDOFF.md`'s browser-constraints section).

Saved source sets (`savedSourceSets.ts` / `ChooseFilesModal.tsx`'s reconnect matching)
deliberately still key on `rootName` + `relativePath`, **not** `rootId` — a saved set
must survive being reconnected in a brand-new session where a brand-new `rootId` will
necessarily be minted, so `rootId` is unusable there by construction. Don't
"fix" that to use `rootId` — it would break saved-set reconnection entirely.

### 10. Click a file in the tree → jump to its instances in the results column

The last feature built this session, workshopped via a short clarifying-questions
round before implementation (see below for the exact decisions).

`FileRow.tsx`: clicking anywhere on a file row *except* the checkbox and Remove button
(both call `e.stopPropagation()` / are separate controls) opens the preview to that
file's first search match, if it has one. If the file currently has no matches (no
search running, filtered out by a file-type chip, or genuinely no hits), the row does
nothing — no click handler fires at all, and the cursor stays default rather than
looking clickable. This does **not** apply to folder rows (`FolderNode.tsx`) — only
individual file rows, by explicit request.

`ResultCard.tsx`'s existing "auto-expand on becoming selected" effect (see #6) was
extended to also call `cardRef.current?.scrollIntoView({ block: 'nearest', behavior:
'smooth' })` — since opening the preview from the tree sets the same `previewTarget`
that clicking the card itself sets, the scroll-and-expand behavior falls out of that
existing effect for free; no separate plumbing needed for the "scroll to it" part.

**Perf-conscious plumbing** (this is the part most likely to need revisiting if a
future change adds more per-file derived state to the tree): rather than having every
`FileRow` call `useSearch()` independently (which would re-render *every* file row on
every search, including ones with no matches — worse than the existing `Sidebar`
tradeoff in #8, because this one scales with typing speed, not just with files being
added), `Sidebar.tsx` calls `useSearch()` once, builds a
`Map<string, {pageNumber, matchIndex}>` of first-match locations, and threads it down
through `FolderNode.tsx` to each `FileRow` as **flat primitive props**
(`firstMatchPageNumber?: number`, `firstMatchIndex?: number` — not a nested object).
This matters: `FileSearchResult` objects are freshly constructed on every search run
(even when the underlying scan came from cache — see `searchFiles.ts`), so passing
that object (or any object built from it) down as a prop would defeat `FileRow`'s
`memo()` every time regardless of whether the values actually changed. Flat numbers
compare correctly by value, so a row only actually re-renders when *its own* match
location changes, even though every intermediate `FolderNode` above it redoes cheap
render-function work on every search.

## How the folder-tree feature was workshopped (context for future changes)

The user explicitly asked to "workshop" feature #8 before building — worth preserving
the Q&A here since some of it isn't otherwise visible in code:

1. Sourceless files (individual picker, loose drops) → grouped under a plain "Other
   Files" heading at the *top* of the tree, not a collapsible folder (no real folder
   behind it).
2. Tree must match the real folder structure exactly, including nested subfolders —
   not flattened to one level.
3. Folders get the *same* actions as files: a checkbox (tri-state, bulk-toggles
   everything nested inside) and a Remove button.
4. Expand/collapse state persists across reloads.
5. Folder checkbox mixed-state → indeterminate.
6. Folder Remove → two-step "Are you sure?" confirm (only for folders — individual
   file rows still remove immediately, unchanged, per an explicit scoping decision
   made when that phrasing came up ambiguous).
7. Sort order: folders before files, alphabetically, at every level.
8. The drag-and-drop-folder feature (#5) didn't originally attach any folder metadata
   — extending it to do so was called out and agreed as in-scope for this work, not a
   separate task.

Feature #10 (click file → jump to instances) also went through a short clarifying
round: confirmed it should also open the preview pane (not just scroll+expand),
should trigger from anywhere on the row (not just the filename text), and should not
apply to folder rows.

## Verification status

`npm run typecheck` and `npm test` both pass as of the last change (22 tests across 6
test files — 3 new ones in `fileTree.test.ts` since `HANDOFF.md` was written, plus 3
more added earlier this session in `searchFiles.test.ts` for the any/all combine-mode
logic).

**No live browser verification was possible for most of this session.** The sandboxed
Browser-pane tooling was unreliable throughout (`screenshot`/`navigate` calls
repeatedly failed with "the Browser pane is not displayed" or "navigation denied,"
across many separate attempts and dev-server restarts) — this looks like an
environment issue in that particular sandbox, not a reflection of the code. **Treat
every feature in this document as needing a real manual smoke test before considering
it done**, especially:

- Drag-and-drop of a real folder (can't be simulated by any automated browser tool
  anyway — needs genuine OS-level `FileSystemEntry` objects from a real drag gesture).
- The folder tree's expand/collapse persistence across an actual page reload.
- Tri-state checkbox visuals (indeterminate rendering is easy to get subtly wrong
  across browsers).
- The two-step folder Remove confirm/reset-on-blur interaction.
- Multi-term search chips + Any/All toggle, end to end, including regex-mode
  chip-hiding.
- Enter-key cycling across multiple files, including the wrap-around case.

## Working-tree status

As of this handoff, `git status --short` shows:

```text
 M src/components/ChooseFilesModal.tsx
 M src/components/DropZone.tsx
 M src/components/FileRow.tsx
 M src/components/ResultCard.tsx
 M src/components/Sidebar.tsx
 M src/store/appStore.ts
 M src/styles/global.css
 M src/types/index.ts
?? src/components/FolderNode.tsx
?? src/lib/files/fileTree.test.ts
?? src/lib/files/fileTree.ts
```

This is features **#8, #9, and #10** (folder tree, unique root ids, click-to-jump) —
**uncommitted**. Features #1–#7 are already committed and pushed as `1167241`. Run the
full typecheck + test suite (and ideally a manual smoke test per the list above)
before committing this remaining work.

## Known follow-up opportunities (not started)

- `ChooseFilesModal.tsx`'s own `ALL_TYPES` constant should be checked against
  `src/lib/files/fileTypes.ts`'s `ALL_FILE_TYPES` — worth confirming they're actually
  unified (they were intended to be, see #3) rather than two lists that could drift.
- The "Other Files" heading has no bulk actions (no checkbox, no remove-all) by
  design (#8, point 1) — revisit if users want that.
- CSV/XLSX search support was discussed earlier (pre-dates this document, see prior
  session context) but explicitly deferred — CSV would be a near-trivial addition
  (same path as `.txt`), XLSX is a much larger lift (new dependency, new
  extraction/highlighting design, no natural "page" concept). Not started.
- `FOCUS_ZOOM_MULTIPLIER` (#7) may need adjusting once someone actually looks at it —
  the original request's intent ("about 1/3") was ambiguous between "reduce by a
  third" (implemented) and "reduce to a third" (not implemented).
