// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseXmlPart } from './xmlSerialization';
import { buildParagraphSpans, getParagraphs } from './paragraphSpans';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function doc(bodyXml: string): string {
  return `<w:document ${W}><w:body>${bodyXml}</w:body></w:document>`;
}

describe('getParagraphs', () => {
  it('finds every <w:p> in document order, including ones nested in a text box run', () => {
    const part = parseXmlPart(
      doc(
        '<w:p><w:r><w:t>outer</w:t></w:r></w:p>' +
          '<w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>',
      ),
    );
    const paragraphs = getParagraphs(part);
    expect(paragraphs).toHaveLength(3);
  });
});

describe('buildParagraphSpans', () => {
  it('concatenates text across multiple runs with correct spans', () => {
    const part = parseXmlPart(doc('<w:p><w:r><w:t>un</w:t></w:r><w:r><w:t>wanted</w:t></w:r></w:p>'));
    const [paragraph] = getParagraphs(part);
    const { combined, spans } = buildParagraphSpans(paragraph);

    expect(combined).toBe('unwanted');
    expect(spans).toEqual([
      { element: spans[0].element, start: 0, end: 2 },
      { element: spans[1].element, start: 2, end: 8 },
    ]);
  });

  it('inserts a barrier character with no span at break elements', () => {
    const part = parseXmlPart(doc('<w:p><w:r><w:t>un</w:t><w:tab/><w:t>wanted</w:t></w:r></w:p>'));
    const [paragraph] = getParagraphs(part);
    const { combined, spans } = buildParagraphSpans(paragraph);

    expect(combined).toBe('un\x00wanted');
    expect(spans).toEqual([
      { element: spans[0].element, start: 0, end: 2 },
      { element: spans[1].element, start: 3, end: 9 },
    ]);
  });

  it('does not descend into a nested paragraph (text box content)', () => {
    const part = parseXmlPart(
      doc(
        '<w:p><w:r><w:t>outer</w:t></w:r><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>boxed</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>',
      ),
    );
    const [paragraph] = getParagraphs(part);
    const { combined, spans } = buildParagraphSpans(paragraph);

    expect(combined).toBe('outer');
    expect(spans).toHaveLength(1);
  });
});
