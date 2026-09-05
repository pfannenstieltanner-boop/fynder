import { getElementsByTag, parseXmlPart, serializeXmlPart } from './xmlSerialization';

const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Registers `extension` in `[Content_Types].xml` if not already present (case-insensitive
 *  extension match, mirroring the ported prototype's `add_content_type`). Returns the original
 *  text byte-for-byte unchanged when the extension is already registered, so adding a PNG when
 *  PNGs already existed doesn't force a pointless reserialize of an unrelated part. */
export function ensureContentType(contentTypesXml: string, extension: string, contentType: string): string {
  const part = parseXmlPart(contentTypesXml);
  const existing = getElementsByTag(part, CONTENT_NS, 'Default');
  const alreadyRegistered = existing.some(
    (el) => (el.getAttribute('Extension') ?? '').toLowerCase() === extension.toLowerCase(),
  );
  if (alreadyRegistered) return contentTypesXml;

  const defaultEl = part.doc.createElementNS(CONTENT_NS, 'Default');
  defaultEl.setAttribute('Extension', extension);
  defaultEl.setAttribute('ContentType', contentType);
  part.doc.documentElement.appendChild(defaultEl);
  return serializeXmlPart(part);
}
