/**
 * Ports the prototype's occurrence-based image replacement. Only edits DrawingML relationships,
 * media parts, and geometry attributes — never introduces a hyperlink, script, or other
 * active-content surface — so it doesn't need to go through `src/lib/docx/security.ts`'s
 * render-time sanitization, which governs the separate mammoth render path this feature bypasses
 * entirely (reviewed, not overlooked).
 */
import { getElementsByTag, parseXmlPart, serializeXmlPart, type XmlPart } from './xmlSerialization';
import type { DocxPackage } from './zipPackage';
import {
  OFFICE_REL_NS,
  addImageRelationship,
  collectUsedRelationshipIds,
  nextRelationshipId,
  parseOrCreateRelsPart,
  relationshipsPathFor,
  serializeRelsPart,
} from './relsXml';
import { ensureContentType } from './contentTypes';
import { computeCropRect, computeFitSize } from './imageGeometry';

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

export type FitMode = 'fit' | 'crop' | 'stretch';

export interface ImageReplaceSelection {
  partPath: string;
  blipIndex: number;
  /** The `r:embed` value recorded at scan time — re-checked before mutating (staleness guard). */
  expectedRelationshipId: string;
}

export interface ImageReplaceOptions {
  selections: ImageReplaceSelection[];
  replacementBytes: Uint8Array;
  /** Lowercase, no leading dot — e.g. "png". */
  extension: string;
  contentType: string;
  imageWidth: number;
  imageHeight: number;
  fitMode: FitMode;
}

export interface ImageReplaceResult {
  replacedCount: number;
}

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

/** Validates the user-picked replacement file's extension, matching the ported prototype's
 *  `image_content_type` (PNG/JPG/JPEG/GIF/BMP only). Throws a plain-sentence error otherwise. */
export function resolveReplacementImageType(fileName: string): { extension: string; contentType: string } {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  const contentType = SUPPORTED_EXTENSIONS[extension];
  if (!contentType) throw new Error('Use a PNG, JPG, GIF, or BMP replacement image.');
  return { extension, contentType };
}

function findNearestDrawing(blip: Element): Element | null {
  let current: Node | null = blip.parentNode;
  while (current) {
    if (
      current.nodeType === Node.ELEMENT_NODE &&
      (current as Element).namespaceURI === WP_NS &&
      ((current as Element).localName === 'inline' || (current as Element).localName === 'anchor')
    ) {
      return current as Element;
    }
    current = current.parentNode;
  }
  return null;
}

// A picture's fill wrapper is `<pic:blipFill>` (the picture namespace) for a standard inserted
// image, but can be `<a:blipFill>` (DRAWING_NS) when an image is used as a generic shape fill.
// The prototype this ports only ever searched DRAWING_NS, which its own test suite happened not
// to catch since it only exercised "fit" mode against a picture shape — crop mode against a real
// inserted picture would have silently no-opped (findBlipFill returning nothing). Matching by
// local name regardless of namespace covers both real cases; `a:srcRect`/`a:stretch` themselves
// are always DRAWING_NS either way, since only the wrapper element's own namespace varies.
function findBlipFill(drawing: Element): Element | null {
  return Array.from(drawing.getElementsByTagName('*')).find((el) => el.localName === 'blipFill') ?? null;
}

function applyFit(blip: Element, imageWidth: number, imageHeight: number, mode: FitMode): void {
  if (mode === 'stretch') return;
  const drawing = findNearestDrawing(blip);
  if (!drawing) return;

  const extent = Array.from(drawing.getElementsByTagNameNS(WP_NS, 'extent'))[0];
  if (!extent) return;
  const frameWidth = Number(extent.getAttribute('cx'));
  const frameHeight = Number(extent.getAttribute('cy'));
  if (!frameWidth || !frameHeight || !imageWidth || !imageHeight) return;

  if (mode === 'fit') {
    const { width, height } = computeFitSize(frameWidth, frameHeight, imageWidth, imageHeight);
    extent.setAttribute('cx', String(width));
    extent.setAttribute('cy', String(height));
    for (const ext of Array.from(drawing.getElementsByTagNameNS(DRAWING_NS, 'ext'))) {
      ext.setAttribute('cx', String(width));
      ext.setAttribute('cy', String(height));
    }
    return;
  }

  // mode === 'crop'
  const fill = findBlipFill(drawing);
  if (!fill) return;
  let crop = Array.from(fill.getElementsByTagNameNS(DRAWING_NS, 'srcRect'))[0];
  if (!crop) {
    crop = blip.ownerDocument.createElementNS(DRAWING_NS, 'a:srcRect');
    // Schema order: srcRect must precede a fill-mode element like stretch, if present.
    const stretch = Array.from(fill.getElementsByTagNameNS(DRAWING_NS, 'stretch'))[0];
    if (stretch) fill.insertBefore(crop, stretch);
    else fill.appendChild(crop);
  }
  const rect = computeCropRect(frameWidth, frameHeight, imageWidth, imageHeight);
  crop.setAttribute('l', String(rect.l));
  crop.setAttribute('t', String(rect.t));
  crop.setAttribute('r', String(rect.r));
  crop.setAttribute('b', String(rect.b));
}

async function loadRelsPart(pkg: DocxPackage, relsPath: string): Promise<XmlPart> {
  const text = pkg.hasPart(relsPath) ? await pkg.getPartText(relsPath) : null;
  return parseOrCreateRelsPart(text);
}

/**
 * Replaces every selected occurrence. Each occurrence gets its own new media part and
 * relationship — the original relationship/media a shared image used is left completely untouched,
 * so other occurrences of the same original image file are unaffected.
 *
 * A staleness mismatch (the blip at a selection's recorded index no longer has the expected
 * `r:embed`) throws immediately, aborting the *whole* call — matching the ported prototype exactly:
 * a bad selection fails the entire document's replacement rather than partially applying the rest,
 * since the caller only calls `pkg.finalize()` after this resolves successfully.
 */
export async function replaceImagesInPackage(pkg: DocxPackage, options: ImageReplaceOptions): Promise<ImageReplaceResult> {
  const { selections, replacementBytes, extension, contentType, imageWidth, imageHeight, fitMode } = options;
  if (selections.length === 0) return { replacedCount: 0 };

  // Media filenames are numbered from the first name not already used anywhere in the package,
  // then simply incremented per occurrence — safe because these are app-generated names nothing
  // else in the package would already use, mirroring the ported prototype exactly.
  const existingNames = new Set(pkg.listAllPartNames().map((name) => name.toLowerCase()));
  let mediaNumber = 1;
  while (existingNames.has(`word/media/fynder_replace_${mediaNumber}.${extension}`.toLowerCase())) mediaNumber += 1;

  const byPart = new Map<string, ImageReplaceSelection[]>();
  for (const selection of selections) {
    const list = byPart.get(selection.partPath) ?? [];
    list.push(selection);
    byPart.set(selection.partPath, list);
  }

  let addedMedia = false;
  let replacedCount = 0;

  for (const [partPath, partSelections] of byPart) {
    const xmlText = await pkg.getPartText(partPath);
    const part = parseXmlPart(xmlText);
    const relsPath = relationshipsPathFor(partPath);
    const relsPart = await loadRelsPart(pkg, relsPath);
    const usedIds = collectUsedRelationshipIds(relsPart);
    const blips = getElementsByTag(part, DRAWING_NS, 'blip');

    for (const selection of partSelections) {
      const blip = blips[selection.blipIndex];
      if (!blip || blip.getAttributeNS(OFFICE_REL_NS, 'embed') !== selection.expectedRelationshipId) {
        throw new Error('The selected image location changed — rescan and try again.');
      }
      const newRid = nextRelationshipId(usedIds);
      usedIds.add(newRid);
      const mediaFileName = `fynder_replace_${mediaNumber}.${extension}`;
      mediaNumber += 1;

      addImageRelationship(relsPart, newRid, mediaFileName);
      blip.setAttributeNS(OFFICE_REL_NS, 'r:embed', newRid);
      applyFit(blip, imageWidth, imageHeight, fitMode);
      pkg.setPartBytes(`word/media/${mediaFileName}`, replacementBytes);
      addedMedia = true;
      replacedCount += 1;
    }

    pkg.setPartText(partPath, serializeXmlPart(part));
    pkg.setPartText(relsPath, serializeRelsPart(relsPart));
  }

  if (addedMedia) {
    const contentTypesXml = await pkg.getPartText('[Content_Types].xml');
    const updated = ensureContentType(contentTypesXml, extension, contentType);
    if (updated !== contentTypesXml) pkg.setPartText('[Content_Types].xml', updated);
  }

  return { replacedCount };
}
