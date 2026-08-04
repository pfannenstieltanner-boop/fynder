# Fynder

Client-side batch document search. Drop PDFs, DOCX, TIFFs, or text files; Fynder
extracts their text (OCR'ing scanned pages), searches across all of them at once,
and previews each hit highlighted in place.

Everything runs in the browser. No server and no upload are required. Runtime
assets, including OCR WASM and language data, are self-hosted in
`public/tesseract/`. A content security policy prevents document content from
opening frames, running injected scripts, or initiating outbound connections.

Note: `package.json` still carries the original project name
`pdf-text-extractor`. The app is Fynder.

## Commands

```bash
npm run dev        # Vite dev server on :5173
npm run build      # tsc -b, then vite build
npm run typecheck  # tsc -b --noEmit
npm test           # Vitest regression suite
npm run preview    # serve dist/
```

Scripts invoke `node node_modules/<pkg>/bin/...` directly rather than relying on
`.bin` shims. Keep that form — the shims are unreliable in this environment.

Vitest covers search caps, pathological match handling, file limits, and DOCX
active-content policy. There is no linter configured.

## Pipeline

```
DropZone → appStore.addFiles → processingManager.processFiles
                                      ↓
              ┌───────────────────────┼────────────────────┬──────────────┐
            PDF                     TIFF                 DOCX          txt/md
       (worker pool)            (worker pool)        (worker pool)   (main thread)
              ↓                       ↓                    ↓              ↓
     text layer per page       every page needs      mammoth raw     file.text()
              ↓                    OCR (no             text
     sufficient? ──no──┐         text layer)
              │        ↓              ↓
             yes    OCR pool ←── OSD rotation pool (TIFF only)
              ↓        ↓
              └────────┴──→ appStore.appendPage → useSearchResults → ResultCard
                                                                          ↓
                                                                    PreviewShell
```

`isPageTextSufficient` (`src/lib/pdf/constants.ts`) is the fork between the text
and OCR paths: a page needs ≥10 characters and ≥3 alphanumeric words to be
trusted as having a real text layer.

## Worker pools

Five processing pools plus disposable search workers. Processing-pool sizes come from
`lib/concurrency.ts`, scaled off
`navigator.hardwareConcurrency` (4 assumed if unavailable) rather than fixed:

| Pool | Size | Where |
|---|---|---|
| PDF extraction | `cores/4`, 1–4 | `processingManager.ts` |
| TIFF extraction | `cores/4`, 1–4 | `processingManager.ts` |
| DOCX extraction | `cores/4`, 1–4 | `processingManager.ts` |
| OCR recognition | `cores-2`, 2–8 | `lib/ocr/tesseractPool.ts` |
| OSD orientation | `cores/8`, 1–2 | `lib/ocr/tesseractPool.ts` |

OCR takes the largest share because it dominates processing time by a wide
margin.

`ExtractionPool` is generic over a worker factory and serves PDF and TIFF.
`DocxExtractionPool` is a near-duplicate that predates the generalization.

Pools are created lazily on first use and restart a crashed worker in place,
marking whatever file it was holding as failed.

### Why OCR and OSD are separate pools

`eng.traineddata` here is LSTM-only. Orientation detection (`DetectOS`) is
Legacy-engine functionality, so asking a recognition worker to also do OSD would
force it into combined Legacy+LSTM mode — which blends in a legacy pass with no
valid tables to read, corrupting `recognize()` output and doubling its work.

The OSD pool therefore loads `osd.traineddata` under `OEM.TESSERACT_ONLY` and
stays entirely apart. Only TIFF uses it; PDF pages are already upright.

Do not merge these pools.

## Coordinate spaces

Every `WordBox` in the store is in its page's **canonical scale=1 reference
frame**, regardless of what resolution the page was actually rasterized at.
Getting this wrong misplaces highlights.

- **PDF** rasterizes for OCR at `OCR_RENDER_SCALE` (2). `tesseractPool` divides
  that factor back out of returned boxes.
- **TIFF** has no separate canonical frame — its native pixel resolution *is*
  scale=1. Large frames are clamped to 3500px for OCR and the resulting scale
  ratio is divided back out the same way.
- **Preview** rendering applies its own scale on top: `PREVIEW_SCALE` is 2.5 for
  PDF, 1 for TIFF. `drawHighlights` multiplies canonical box coordinates by it.

If a TIFF page was rotated before OCR, its boxes are in the *rotated* frame, and
`renderTiffPageToCanvas` re-applies the same rotation so the displayed image
matches. `PageData.rotation` records it.

## State

Single zustand store, `src/store/appStore.ts`. Files live in a
`Record<id, FileRecord>` plus a `fileOrder` array for stable display order.

Because any update replaces that whole map, components should select the
narrowest thing they need — a primitive, or one file's record — rather than
`s.files`. `FileRow` takes a `fileId` and selects its own record for exactly this
reason, so extracting a page from one file doesn't re-render every row.

Raw `File` objects are held outside React in `lib/pdf/fileCache.ts` (a plain
`Map`), because previews need the original bytes and files aren't serializable
state. Decoded documents are cached separately with small LRU bounds in
`renderPage.ts` (four pdf.js proxies) and `renderTiffPage.ts` (two decoded RGBA
documents).

`removeFile` evicts all three caches and cancels queued or active extraction,
OCR, and orientation work for that file. LRU pressure can also evict decoded
previews. Cache eviction reaches the decoded-document caches through
`lib/previewCaches.ts`, a registry each cache
module writes itself into when it loads — the store must not import those modules
directly, or pdf.js and utif2 land back in the initial bundle. A new preview-side
cache should call `registerPreviewCache` rather than being wired into the store.

Theme is applied to `document.documentElement.dataset.theme` at module load,
before React mounts, to avoid a flash of the wrong theme.

## Search

`SearchProvider` (`contexts/SearchContext.tsx`) is the single owner of both the
200 ms debounce and the cross-file search; everything that needs either consumes
`useSearch()`. Do not reintroduce a local `useDebouncedValue` in a component —
independent timers fire on different ticks and visibly desync the results list
from the preview overlay. User patterns execute only in disposable search
workers with a five-second termination timeout; never execute them on the UI
thread.

`lib/search/searchFiles.ts` caps retained results while scanning, so even one
file cannot exceed `MAX_TOTAL_MATCHES`. Search results include per-page match
ranges; PDF, TIFF, and text previews consume those ranges instead of evaluating
patterns again. DOCX rendered-DOM matching uses the same worker boundary.

`buildSearchRegex` escapes the query in `plain` mode and passes it through in
`regex` mode, always `gi`. Invalid user regexes surface as `regexError` rather
than throwing.

Caps, in `lib/search/constants.ts`: exactly 500 retained total matches, 50
displayed occurrences per file, and a 60-character snippet radius. `findMatches`
accepts an exact caller-supplied cap and guards against zero-length-match loops.

## Safety limits

`lib/files/limits.ts` is the single source of truth for file, batch, page-count,
expanded-DOCX, dimension, and pixel limits. Validate dimensions before decoding
TIFF RGBA or allocating PDF canvases. Limit failures are user-visible; OCR page
failures produce a searchable `partial` file rather than a misleading `done`
file.

`matchIndex` is an **ordinal** — "the Nth match on this page in reading order" —
not an offset. The previews rely on their own independently-extracted text
agreeing with the store's on that ordering. DOCX goes further and highlights
against the rendered DOM's text nodes rather than mammoth's extraction, on the
same ordinal assumption.

## Previews

`PreviewShell` dispatches on `fileType` to one of four components. The PDF, TIFF,
and DOCX ones are `React.lazy` chunks behind a `Suspense` boundary, since each
pulls a heavy renderer; `TextPreview` stays eager because it has no dependencies
beyond what's already in the main chunk. Highlight drawing lives in
`lib/highlight/drawHighlights.ts`, deliberately apart from `renderPage.ts` so the
TIFF chunk doesn't have to pull pdf.js in for it.

All three share `hooks/useZoomPan.ts` and `components/ZoomToolbar.tsx`: ctrl+wheel
cursor-anchored zoom, pointer-drag panning with a 3px click threshold, and toolbar
buttons stepping 25% within 50–200% of fit scale. Wheel and drag are deliberately
unconstrained by that range; auto-zoom-to-match routinely exceeds it to make small
text legible, and the button handler has specific logic so "+"/"−" still behave
sensibly from outside the grid. Put viewport changes in the hook, not in one
preview.

The hook takes a natural content size and returns `stackStyle` plus `focusRect`,
which centers a rect given in *content* coordinates. PDF and TIFF pass the rect
`drawHighlights` returns; DOCX has no such rect and reads the active `<mark>`'s
position back from the DOM, dividing out the current zoom first.

PDF and TIFF draw highlights onto an overlay canvas stacked over the page raster.
DOCX and text preview wrap matches in real `<mark>` elements.

## Conventions

- TypeScript strict. No `any` in application code; the few casts around pdf.js
  and mammoth types are localized and commented.
- Comments explain *why*, not *what* — particularly around the non-obvious
  constraints above. Match that density.
- Errors reaching the user are plain sentences, never raw exception text.
- `try`/`catch` around `localStorage` everywhere; persistence is a nice-to-have.
- BEM-ish CSS class names in one global stylesheet. No CSS modules, no CSS-in-JS.

## Known weak points

Documented so they aren't rediscovered. This list is for awareness, not a work
queue — do not act on these unless asked.

- **OCR images round-trip through PNG.** `rasterizePage` encodes to PNG, and
  tesseract.js decodes it again. This is unavoidable with the current library:
  its `loadImage` normalizes every input — even an `OffscreenCanvas` — to an
  encoded byte array, so there's no raw-pixel path. Switching to JPEG would cut
  encode time but risks OCR accuracy from ringing artifacts around glyph edges,
  and the encode is a small fraction of per-page recognition cost. Not worth it.
- **Preview rasterizes once at a fixed `PREVIEW_SCALE`**, so zooming past ~250%
  upscales a fixed bitmap and looks soft. Re-rendering at the target scale on
  zoom would fix it. Also not `devicePixelRatio`-aware.
- **`DocxExtractionPool` duplicates `ExtractionPool`** almost entirely; it
  predates that class being generalized over a worker factory.
