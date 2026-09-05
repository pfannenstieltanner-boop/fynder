import { getElementsByTag, parseXmlPart, serializeXmlPart, type XmlPart } from './xmlSerialization';

export const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_REL_SUFFIX = '/image';

/** OPC convention: a part's relationships live at `<dir>/_rels/<filename>.rels`. */
export function relationshipsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : partPath.slice(0, slash + 1);
  const filename = slash === -1 ? partPath : partPath.slice(slash + 1);
  return `${dir}_rels/${filename}.rels`;
}

/** Resolves a relationship's `Target` (relative to the owning part's directory, or absolute if it
 *  starts with "/") to a normalized full package path. */
function resolveTarget(sourcePartPath: string, target: string): string {
  const slash = sourcePartPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : sourcePartPath.slice(0, slash);
  const combined = target.startsWith('/') ? target : dir ? `${dir}/${target}` : target;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/** Parses a `.rels` part into id -> resolved target-part path, keeping only relationships whose
 *  `Type` ends with "/image" — mirrors the ported prototype's `parse_relationships`. */
export function parseImageRelationships(relsXmlText: string, sourcePartPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const part = parseXmlPart(relsXmlText);
  for (const rel of getElementsByTag(part, REL_NS, 'Relationship')) {
    const type = rel.getAttribute('Type') ?? '';
    if (!type.endsWith(IMAGE_REL_SUFFIX)) continue;
    const id = rel.getAttribute('Id') ?? '';
    const target = rel.getAttribute('Target') ?? '';
    map.set(id, resolveTarget(sourcePartPath, target));
  }
  return map;
}

const EMPTY_RELATIONSHIPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"/>`;

/** A `.rels` part that didn't previously exist is synthesized fresh, matching the ported
 *  prototype's fallback when a part (e.g. a header with no images yet) has no `.rels` file. */
export function parseOrCreateRelsPart(relsXmlText: string | null): XmlPart {
  return parseXmlPart(relsXmlText ?? EMPTY_RELATIONSHIPS_XML);
}

export function collectUsedRelationshipIds(part: XmlPart): Set<string> {
  return new Set(getElementsByTag(part, REL_NS, 'Relationship').map((rel) => rel.getAttribute('Id') ?? ''));
}

/** Picks the first `rIdFynderReplace<N>` not already present in `usedIds`. */
export function nextRelationshipId(usedIds: ReadonlySet<string>): string {
  let n = 1;
  while (usedIds.has(`rIdFynderReplace${n}`)) n += 1;
  return `rIdFynderReplace${n}`;
}

/** Appends a new Relationship element for a cloned media part. Every existing relationship is
 *  left untouched, which is what keeps other occurrences of a shared image unaffected. */
export function addImageRelationship(part: XmlPart, id: string, mediaFileName: string): void {
  const relationship = part.doc.createElementNS(REL_NS, 'Relationship');
  relationship.setAttribute('Id', id);
  relationship.setAttribute('Type', `${OFFICE_REL_NS}/image`);
  relationship.setAttribute('Target', `media/${mediaFileName}`);
  part.doc.documentElement.appendChild(relationship);
}

export { serializeXmlPart as serializeRelsPart };
