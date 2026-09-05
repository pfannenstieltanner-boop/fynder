import JSZip from 'jszip';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DEFAULT_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
</Types>`;

const DEFAULT_PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export interface TestDocxOptions {
  /** Path relative to the zip root (e.g. "word/document.xml") -> XML text. */
  textParts: Record<string, string>;
  /** Path -> raw bytes (e.g. "word/media/image1.png"). */
  binaryParts?: Record<string, Uint8Array>;
}

/** Builds a minimal in-memory docx zip for tests — no binary fixture files are checked in,
 *  matching how existing Vitest suites (e.g. matchLocations.test.ts) build fixtures inline. */
export async function buildTestDocx(options: TestDocxOptions): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', DEFAULT_CONTENT_TYPES);
  zip.file('_rels/.rels', DEFAULT_PACKAGE_RELS);
  for (const [path, xml] of Object.entries(options.textParts)) {
    zip.file(path, xml);
  }
  for (const [path, bytes] of Object.entries(options.binaryParts ?? {})) {
    zip.file(path, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'test.docx', { type: DOCX_MIME });
}

export const W_XMLNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function wordDocument(bodyXml: string, extraAttrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_XMLNS}${extraAttrs}><w:body>${bodyXml}</w:body></w:document>`;
}

/** Namespace declarations a real Word document.xml carries for a body with pictures in it. */
const PICTURE_DOC_XMLNS = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(' ');

export function wordDocumentWithPictures(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${PICTURE_DOC_XMLNS}><w:body>${bodyXml}</w:body></w:document>`;
}

/** A `<w:p>` containing one inline picture — the same `pic:blipFill`/`pic:spPr` structure a real
 *  Word document uses for a standard inserted image (as opposed to an image used as a generic
 *  shape fill, which would use `a:blipFill` instead). */
export function pictureParagraph(relationshipId: string, extentCx = 914400, extentCy = 914400): string {
  return (
    '<w:p><w:r><w:drawing>' +
    `<wp:inline><wp:extent cx="${extentCx}" cy="${extentCy}"/>` +
    '<a:graphic><a:graphicData><pic:pic>' +
    `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extentCx}" cy="${extentCy}"/></a:xfrm></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>'
  );
}

export function relationshipsXml(entries: Array<{ id: string; type: string; target: string }>): string {
  const rels = entries
    .map((e) => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

export const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
