import { getElementsByTag, parseXmlPart } from './xmlSerialization';
import { IMAGE_PART_RE, loadDocxPackage } from './zipPackage';
import { OFFICE_REL_NS, parseImageRelationships, relationshipsPathFor } from './relsXml';

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export type ImageLocation = 'Body' | 'Header' | 'Footer';

export interface ImageOccurrence {
  /** Unique within one file's scan — `<partPath>#<blipIndex>`. Used for UI keying/selection. */
  id: string;
  fileId: string;
  fileName: string;
  partPath: string;
  /** This blip's position among *every* `<a:blip>` in the part, in document order — including
   *  ones that don't resolve to a usable media part. Positional, not sequential-among-matches, to
   *  stay consistent with `replaceImagesInPackage`'s re-fetch-and-index-into approach. */
  blipIndex: number;
  relationshipId: string;
  mediaPartPath: string;
  mediaBytes: Uint8Array;
  location: ImageLocation;
}

function locationForPart(partPath: string): ImageLocation {
  const filename = partPath.slice(partPath.lastIndexOf('/') + 1).toLowerCase();
  if (filename.startsWith('header')) return 'Header';
  if (filename.startsWith('footer')) return 'Footer';
  return 'Body';
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** Best-effort MIME type for rendering an existing embedded media part as a thumbnail — not the
 *  same lookup as the replacement-file validation in imageReplace.ts, which only accepts the four
 *  supported extensions; an existing document may embed other raster formats Fynder can still
 *  preview via `<img>` even though it won't accept them as a *replacement* file. */
export function mimeTypeForMediaPart(mediaPartPath: string): string {
  const dot = mediaPartPath.lastIndexOf('.');
  const ext = dot === -1 ? '' : mediaPartPath.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/**
 * Enumerates every `<a:blip r:embed>` occurrence across `word/document.xml`/`header*.xml`/
 * `footer*.xml`, in document order per part, resolved through that part's `.rels` file. Mirrors
 * the ported prototype's `scan_images` — only DrawingML embedded raster images are found; VML
 * fallback drawings and externally linked (`r:link`) images are not.
 *
 * Runs on the main thread as each file is selected in the modal (see runBatchEdit.ts's module
 * comment on why batch-edit work here runs off the worker path) — read-only, gates interactive
 * UI, and is bounded by the same zip-bomb guard everything else in this folder uses.
 */
export async function scanImageOccurrences(fileId: string, file: File): Promise<ImageOccurrence[]> {
  const pkg = await loadDocxPackage(file);
  const occurrences: ImageOccurrence[] = [];
  const allParts = new Set(pkg.listAllPartNames());

  for (const partPath of pkg.listPartsMatching(IMAGE_PART_RE)) {
    const relsPath = relationshipsPathFor(partPath);
    if (!allParts.has(relsPath)) continue;
    const relsXmlText = await pkg.getPartText(relsPath);
    const rels = parseImageRelationships(relsXmlText, partPath);
    if (rels.size === 0) continue;

    const xmlText = await pkg.getPartText(partPath);
    const part = parseXmlPart(xmlText);
    const blips = getElementsByTag(part, DRAWING_NS, 'blip');
    const location = locationForPart(partPath);

    for (let index = 0; index < blips.length; index++) {
      const relationshipId = blips[index].getAttributeNS(OFFICE_REL_NS, 'embed') ?? '';
      const mediaPartPath = rels.get(relationshipId);
      if (!mediaPartPath || !allParts.has(mediaPartPath)) continue;
      const mediaBytes = await pkg.getPartBytes(mediaPartPath);
      occurrences.push({
        id: `${partPath}#${index}`,
        fileId,
        fileName: file.name,
        partPath,
        blipIndex: index,
        relationshipId,
        mediaPartPath,
        mediaBytes,
        location,
      });
    }
  }
  return occurrences;
}
