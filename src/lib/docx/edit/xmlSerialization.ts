/**
 * The single seam that touches `DOMParser`/`XMLSerializer` for editing Word XML parts. Every
 * other module in `lib/docx/edit` goes through this file instead of touching the DOM directly, so
 * that if the browser's serializer ever turns out not to preserve namespace declarations the way
 * `xmlSerialization.test.ts` requires (see that file for why this matters — Word's "needs repair"
 * prompt is caused by a serializer dropping an `xmlns:` declaration still referenced by
 * `mc:Ignorable`), the fix is contained to this one file rather than rippling through every module
 * that edits XML.
 */

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS_URI = 'http://www.w3.org/XML/1998/namespace';

export interface XmlPart {
  readonly doc: XMLDocument;
}

export function parseXmlPart(xmlText: string): XmlPart {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse Word XML part: malformed document.');
  }
  return { doc };
}

export function serializeXmlPart(part: XmlPart): string {
  return new XMLSerializer().serializeToString(part.doc);
}

export function getElementsByTag(part: XmlPart, namespaceUri: string, localName: string): Element[] {
  return Array.from(part.doc.getElementsByTagNameNS(namespaceUri, localName));
}

/** Word/XML processors collapse leading/trailing whitespace in a `<w:t>` run unless this is set. */
export function setPreserveSpace(element: Element): void {
  element.setAttributeNS(XML_NS_URI, 'xml:space', 'preserve');
}
