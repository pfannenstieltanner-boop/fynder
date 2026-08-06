# Fynder Recursive File Discovery Handoff

Date: 2026-08-05

## Purpose

This handoff covers the new recursive file-discovery workflow added to Fynder. The feature helps users locate useful documents inside large or poorly documented folder structures before importing those documents into a Fynder search session.

Example problem: a former marketing employee used particular folder locations and filename conventions, but did not document them. A coworker can now authorize broad marketing folders, recursively search folder paths and filenames, review the matches, and add only the relevant documents to Fynder.

## Product model

The new workflow searches file-system structure and metadata before Fynder searches document contents:

```text
User-authorized root folders
        ↓
Recursive local discovery
        ↓
Folder-name, filename, and file-type filtering
        ↓
Review and select matching files
        ↓
Add selected files to the Fynder session
        ↓
Existing extraction, OCR, and content search
```

Important principles:

- Access is read-only.
- Fynder cannot inspect anything outside roots explicitly selected by the user.
- Subfolders are included by default but can be disabled.
- Discovery reads names, relative paths, and basic file metadata.
- Extraction and OCR do not begin until the user confirms which files to add.
- Files and extracted document contents remain session-only.
- Saved source sets store recipes and file references, never document bytes or extracted text.

## User experience

The existing **Choose files** button now opens a modal with two modes:

1. **Search folders** — the new default workflow.
2. **Select individual files** — preserves the standard browser file picker.

Drag-and-drop continues to work as before.

### Folder workflow

The modal is organized into three steps:

1. **Choose where to look**
   - Select one or more root folders.
   - Include all subfolders by default.
   - Rescan or cancel an active scan.
   - Remove a selected root.

2. **Narrow the results**
   - Enter multiple folder-name terms as removable chips.
   - Enter multiple filename terms as removable chips.
   - Press Enter or type a comma to commit a term.
   - Choose **Match any term** or **Match all terms** independently for folder and filename searches.
   - When both folder and filename terms exist, choose **Match both** or **Match either**.
   - Filter to PDF, DOCX, TIFF, TXT, and/or Markdown.

3. **Review matching files**
   - See filenames, relative paths, types, sizes, progress, and selection counts.
   - Select visible matches or clear the selection.
   - Selection respects the remaining 100-file session capacity.
   - Only selected files are passed into the existing processing pipeline.

The modal supports Escape-to-close, backdrop closing, keyboard focus containment, and focus restoration.

## Matching behavior

Filtering is case-insensitive plain-text substring matching.

- Folder terms search the complete relative parent-folder path.
- Filename terms search the filename, including its extension.
- A multi-word chip such as `construction project` is treated as one phrase.
- Blank term lists impose no restriction.
- Duplicate and blank chip entries are discarded.
- Folder and filename sections can independently require any or all terms.
- If both sections contain terms, `combineMode` determines whether both sections or either section must match.
- Results update locally without rescanning when only filters change.
- Changing the **Include all subfolders** option requires a rescan because it changes discovery scope.

## Saved source sets

The modal can save a reusable source set to `localStorage` under:

```text
fynder:savedSourceSets
```

A saved set contains:

- Schema version
- User-provided name
- Creation and update timestamps
- Root folder display names
- Folder, filename, combination, file-type, and recursion filters
- Selected file references expressed as root name plus relative path

It does not contain:

- Absolute operating-system paths
- Directory or file handles
- Document bytes
- Extracted text
- OCR results

When a saved set is opened, Fynder restores its filters and asks the user to reconnect the named roots. After rescanning, previously selected relative paths are selected again when still available.

The initial implementation supports creating and reopening saved source sets. Rename, update-in-place, and deletion management have not been added yet.

## Architecture and changed files

### Modal and integration

- `src/components/ChooseFilesModal.tsx`
  - Owns temporary roots, scan progress, discovered files, filters, selections, saved-set state, and modal accessibility.
  - Uses a React portal so the modal is not clipped by the sidebar.
  - Keeps directory and file handles out of Zustand and persistence.

- `src/components/DropZone.tsx`
  - Opens the modal from **Choose files**.
  - Retains drag-and-drop behavior.
  - Uses the new shared importer.

- `src/styles/global.css`
  - Adds theme-aware BEM-style modal, filter, chip, table, and responsive styles.

### Discovery and filtering

- `src/lib/files/directoryDiscovery.ts`
  - Breadth-first asynchronous traversal of selected roots.
  - Optional subfolder recursion.
  - Emits supported files in batches of 100.
  - Yields between batches to keep the UI responsive.
  - Supports `AbortSignal` cancellation.
  - Tracks scanned, supported, inaccessible, and truncated counts.
  - Stops after `MAX_DISCOVERY_ENTRIES`, currently 50,000 entries per root scan.

- `src/lib/files/discoveryTypes.ts`
  - Defines `FolderRoot`, `DiscoveredFile`, `TermFilter`, and `DiscoveryFilters`.

- `src/lib/files/filterDiscoveredFiles.ts`
  - Pure multi-term filtering function.
  - Kept separate from traversal so filter changes do not require another file-system scan.

- `src/types/fileSystemAccess.d.ts`
  - Supplies missing TypeScript declarations for `showDirectoryPicker()` and asynchronous directory iteration.

### Shared ingestion

- `src/lib/files/importFiles.ts`
  - Centralizes supported-format validation, legacy `.doc` reporting, file and batch limits, Zustand insertion, raw-file caching, and processing startup.
  - Used by drag-and-drop, the individual picker, and recursive discovery.

- `src/store/appStore.ts`
  - `addFiles` now accepts `ImportFileCandidate[]` rather than raw `File[]`.
  - File records can carry optional source metadata.

- `src/types/index.ts`
  - Adds `FileSource` and `ImportFileCandidate`.
  - Adds optional `source` metadata to `FileRecord`:

```ts
source?: {
  rootName: string;
  relativePath: string;
}
```

This distinguishes files with the same name in different folders.

### Saved-set persistence

- `src/lib/files/savedSourceSets.ts`
  - Versioned schema and guarded `localStorage` loading/saving.
  - Invalid or unavailable persistence falls back safely to an empty list.

### Tests

- `src/lib/files/directoryDiscovery.test.ts`
  - Recursive traversal
  - Root-only traversal
  - Relative path preservation
  - Unsupported-file exclusion
  - Cancellation

- `src/lib/files/filterDiscoveredFiles.test.ts`
  - Multiple filename terms
  - Any/all behavior
  - Folder-only matching
  - Folder/file both-or-either behavior
  - File-type filtering
  - Case-insensitive matching

## Existing limits and new safeguards

The existing limits in `src/lib/files/limits.ts` remain authoritative when selected files are imported:

- 100 MB per file
- 200 MB of currently loaded documents
- 100 currently loaded files

Discovery adds a separate 50,000-entry scan limit. The modal also:

- Allows cancellation.
- Reports inaccessible items.
- Reports a truncated scan.
- Limits rendered results to the first 500 matches and asks users to refine filters when more exist.
- Prevents selecting more files than the remaining session capacity.
- Rechecks all normal limits immediately before import.
- Deduplicates the same selected file when it is reached through overlapping roots by using `FileSystemHandle.isSameEntry()`.

## Browser constraints

Recursive discovery depends on the File System Access API and feature-detects `window.showDirectoryPicker`.

- Target current desktop Chromium browsers, particularly Microsoft Edge and Google Chrome on Windows.
- The application must run in a secure context; `localhost` qualifies during development.
- Unsupported browsers still retain individual file selection.
- The operating-system folder picker and permission grant require a real user interaction and cannot be silently invoked.
- Browsers do not expose general absolute paths. Fynder works with selected root names and paths relative to those roots.
- Protected, unavailable, cloud-placeholder, or network locations may fail at enumeration or when the selected file is reopened for import. These failures are handled as user-facing unavailable/inaccessible counts.

## Verification completed

The implementation was verified on 2026-08-05:

```text
npm run typecheck  → passed
npm test           → 5 test files, 16 tests passed
npm run build      → passed
```

A local Playwright browser check also verified:

- The modal opens from **Choose files**.
- The default folder-search mode renders correctly.
- The individual-file mode remains available.
- Two terms (`project` and `construction`) can be entered as independent removable chips.
- The any/all and both/either controls are exposed correctly.
- No application console errors were observed.

The native operating-system folder selection dialog was not automated. Recursive traversal itself is covered by mocked-handle unit tests and still needs a manual smoke test against real local, OneDrive, and network folders.

## Recommended next checks

Before considering the feature finished for end users:

1. Manually test a small local folder in Edge or Chrome.
2. Test a deeply nested directory and confirm relative paths.
3. Test a locally synchronized OneDrive directory.
4. Test cloud-only OneDrive placeholders and confirm graceful failures.
5. Test an accessible company network folder.
6. Test overlapping selected roots for duplicate suppression.
7. Test files renamed or deleted between discovery and import.
8. Test near the 100-file and 200 MB session limits.
9. Confirm whether 50,000 scanned entries and 500 rendered matches are appropriate after real usage.

## Known follow-up opportunities

- Saved-set rename, delete, and update-in-place controls.
- Show new, missing, renamed, or moved files when rebuilding a saved set.
- Virtualize the results table instead of displaying a maximum of 500 rows.
- Add include/exclude terms if repeated user demand appears.
- Add starts-with, ends-with, or exact-name modes if substring matching proves insufficient.
- Persist directory handles in IndexedDB only if users strongly value fewer reconnect prompts and the permission UX is validated.
- Add a formal component-test environment for modal interactions and accessibility.
- Consider moving scanning into a worker only if real large-folder testing shows the current asynchronous batching is insufficient.

## Working-tree status

The implementation is present in the working tree and has not been committed. Preserve unrelated user work if additional changes are made. Run the full typecheck, test suite, and production build after any follow-up edits.
