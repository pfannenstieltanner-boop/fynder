# Fynder

Fynder is a private, browser-based document search tool for finding terms across batches of PDFs, TIFFs, Word documents, text files, and Markdown files. It extracts text locally, searches every selected file together, and highlights each result in its document preview.

**[Try it live →](https://fynder-smoky.vercel.app/)**

Document contents stay in the browser: Fynder has no application server and does not upload files for processing.

## What it does

- Search across many documents with plain-text or regular-expression queries.
- Search one or more terms using **Any** or **All** matching.
- Preview each result in place and move between occurrences.
- Read text-layer PDFs directly and OCR scanned PDFs/TIFFs locally.
- Import individual files, drag-and-drop files or folders, and organize imported folder contents in a sidebar tree.
- Filter the search by file type or include/exclude individual files.

## Supported file types

| Type | Extensions | Processing |
| --- | --- | --- |
| PDF | `.pdf` | Text extraction; OCR when a usable text layer is absent |
| TIFF | `.tif`, `.tiff` | Local OCR |
| Word | `.docx` | Text extraction and document preview |
| Text | `.txt` | Direct text extraction |
| Markdown | `.md`, `.markdown` | Direct text extraction |

Legacy `.doc` files are not supported. Save them as `.docx` before importing.

## Getting started

1. Install a current Node.js LTS release.
2. Clone this repository.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the local address shown in the terminal.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm test` | Run the regression test suite |
| `npm run typecheck` | Validate TypeScript types |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |

## Privacy and security

Fynder is designed for local-only document processing:

- Files are processed in the browser and are not uploaded by the application.
- PDF, TIFF, and OCR work runs in background workers to keep the interface responsive.
- OCR runtime assets are self-hosted under `public/tesseract/`.
- A content-security policy prevents imported document content from opening frames, running scripts, or making outbound requests.

## Operating limits

To keep browser memory use predictable, Fynder currently enforces these limits:

- 100 MB per file and 200 MB per loaded session
- 100 simultaneously loaded files
- 2,000 pages per document
- TIFF/PDF source pages up to 40 million pixels and 20,000 pixels on either side

Large TIFFs are downscaled for OCR once their longest side exceeds 3,500 pixels. See the in-app error message if a source image exceeds the safety limits.

## Project structure

```text
src/
  components/  User interface and document previews
  contexts/    Shared search state
  lib/         File import, search, OCR, preview, and safety helpers
  store/       Application state
  workers/     PDF, TIFF, DOCX, and search background workers
public/
  tesseract/   Self-hosted OCR runtime assets
```

For implementation details, conventions, and architecture notes, see [CLAUDE.md](CLAUDE.md).
