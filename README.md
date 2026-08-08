# Fynder

Client-side batch document search. Drop in PDFs, DOCX files, TIFFs, or plain
text/Markdown — Fynder extracts their text (OCR'ing scanned pages automatically),
searches across all of them at once, and shows every hit highlighted in place in
a live preview.

**[Try it live →](https://fynder-smoky.vercel.app/)**

## Why

Everything runs entirely in your browser. Nothing is uploaded anywhere — there's
no server, no account, and no network request involved in processing your
documents. It's built for searching through a batch of files (contracts, scanned
forms, reports, whatever) without shipping their contents off your machine.

## Features

- **Batch search across mixed file types** — PDF, DOCX, TIFF, TXT, and Markdown,
  all searched together.
- **OCR for scanned documents** — pages with no real text layer are recognized
  automatically (via Tesseract, running in the browser).
- **Plain-text or regex search**, with support for multiple search terms:
  press <kbd>Tab</kbd> to add another term, and choose whether a file must match
  *all* of them or just *one*.
- **File-type filter chips** to narrow which loaded files are actually searched.
- **Folder-aware import** — drag and drop a whole folder (subfolders included),
  or use the recursive folder-search picker to filter by folder/file name and
  file type before importing. Reusable "source sets" let you save a
  folder + filter combination and re-run it later.
- **Folder tree view** in the sidebar mirrors your real folder structure, with
  per-file and per-folder include/exclude toggles.
- **Live, highlighted previews** for every match, with zoom/pan, keyboard
  cycling through instances (<kbd>Enter</kbd>), and jump-to-file navigation.
- **Dark and light themes.**

## Getting started

Requires Node.js (18+ recommended).

```bash
git clone https://github.com/pfannenstieltanner-boop/fynder.git
cd fynder
npm install
npm run dev
```

Then open the printed `localhost` URL. That's it — no environment variables,
no backend, no accounts.

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check, then build a production bundle to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the Vitest suite |

## Supported files & limits

PDF, DOCX, TIFF, TXT, and Markdown are supported (legacy `.doc` is not — save as
`.docx` first). To keep a browser tab responsive, a session is capped at 100 MB
per file, 200 MB total, and 100 files loaded at once.

## Browser support

Built for current Chromium-based desktop browsers (Chrome, Edge). Recursive
folder import uses the File System Access API, which isn't available everywhere
— browsers without it fall back to selecting individual files instead of whole
folders. The app must run in a secure context (`https://`, or `localhost` in
development).

## Privacy

A strict content security policy prevents document content from opening frames,
running injected scripts, or making outbound network connections. Files, their
extracted text, and OCR results never leave your machine and exist only for the
current browser session — nothing is persisted to a server because there isn't
one.

## Development

This project is developed with the help of an AI coding agent. [`CLAUDE.md`](./CLAUDE.md)
documents the architecture, processing pipeline, worker pool design, and a
number of non-obvious implementation details and known trade-offs — read it
before making significant changes.
