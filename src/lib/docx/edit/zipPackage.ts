import JSZip from 'jszip';
import { assertDocxSafeToExpand } from '../../files/limits';

/** `word/document.xml`, `header*.xml`/`footer*.xml`, and the other text-bearing parts a Word
 *  document can carry — text boxes are covered implicitly since a `w:txbxContent` lives inline
 *  inside whichever of these parts contains it. */
export const TEXT_PART_RE = /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments|glossary\/document)\.xml$/i;

/** Images are only scanned/replaced in the body, headers, and footers — not footnotes/endnotes/
 *  comments/glossary, matching the ported prototype's scope. */
export const IMAGE_PART_RE = /^word\/(document|header\d+|footer\d+)\.xml$/i;

export interface DocxPackage {
  listPartsMatching(re: RegExp): string[];
  listAllPartNames(): string[];
  hasPart(path: string): boolean;
  getPartText(path: string): Promise<string>;
  setPartText(path: string, xml: string): void;
  getPartBytes(path: string): Promise<Uint8Array>;
  /** Adds a brand-new part (e.g. a cloned media file) or overwrites an existing one's raw bytes. */
  setPartBytes(path: string, bytes: Uint8Array | ArrayBuffer): void;
  /** Serializes the package. Parts never touched via `setPartText`/`setPartBytes` keep their
   *  original compressed representation — JSZip only recompresses entries it was asked to change
   *  — so untouched parts stay byte-identical to the source, matching the prototype's "only
   *  rewrite what actually changed" discipline. */
  finalize(): Promise<Blob>;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

class JSZipDocxPackage implements DocxPackage {
  constructor(private readonly zip: JSZip) {}

  listPartsMatching(re: RegExp): string[] {
    return this.listAllPartNames().filter((name) => re.test(name));
  }

  listAllPartNames(): string[] {
    const names: string[] = [];
    this.zip.forEach((path, entry) => {
      if (!entry.dir) names.push(path);
    });
    return names;
  }

  hasPart(path: string): boolean {
    return this.zip.file(path) != null;
  }

  async getPartText(path: string): Promise<string> {
    const entry = this.zip.file(path);
    if (!entry) throw new Error(`Word document is missing expected part: ${path}`);
    return entry.async('string');
  }

  setPartText(path: string, xml: string): void {
    this.zip.file(path, xml);
  }

  async getPartBytes(path: string): Promise<Uint8Array> {
    const entry = this.zip.file(path);
    if (!entry) throw new Error(`Word document is missing expected part: ${path}`);
    return entry.async('uint8array');
  }

  setPartBytes(path: string, bytes: Uint8Array | ArrayBuffer): void {
    this.zip.file(path, bytes);
  }

  finalize(): Promise<Blob> {
    return this.zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME });
  }
}

export async function loadDocxPackage(file: File): Promise<DocxPackage> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  let entryCount = 0;
  let expandedBytes = 0;
  zip.forEach((_path, entry) => {
    entryCount++;
    const data = entry as typeof entry & { _data?: { uncompressedSize?: number } };
    expandedBytes += data._data?.uncompressedSize ?? 0;
  });
  assertDocxSafeToExpand(entryCount, expandedBytes);
  return new JSZipDocxPackage(zip);
}
