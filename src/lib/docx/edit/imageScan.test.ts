// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scanImageOccurrences } from './imageScan';
import {
  IMAGE_REL_TYPE,
  buildTestDocx,
  pictureParagraph,
  relationshipsXml,
  wordDocumentWithPictures,
} from './testHelpers';

const BODY_IMAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const HEADER_IMAGE_BYTES = new Uint8Array([5, 6, 7]);

async function buildFixture(): Promise<File> {
  // Two body pictures share the same original image (rId1 -> image1.png); one header picture
  // uses a separate image — mirrors the prototype's own test fixture shape (2 body + 1 header).
  const documentXml = wordDocumentWithPictures(pictureParagraph('rId1', 100000, 100000) + pictureParagraph('rId1', 200000, 100000));
  const documentRels = relationshipsXml([{ id: 'rId1', type: IMAGE_REL_TYPE, target: 'media/image1.png' }]);
  const headerXml = wordDocumentWithPictures(pictureParagraph('rId1'));
  const headerRels = relationshipsXml([{ id: 'rId1', type: IMAGE_REL_TYPE, target: 'media/header-image.png' }]);

  return buildTestDocx({
    textParts: {
      'word/document.xml': documentXml,
      'word/_rels/document.xml.rels': documentRels,
      'word/header1.xml': headerXml,
      'word/_rels/header1.xml.rels': headerRels,
    },
    binaryParts: {
      'word/media/image1.png': BODY_IMAGE_BYTES,
      'word/media/header-image.png': HEADER_IMAGE_BYTES,
    },
  });
}

describe('scanImageOccurrences', () => {
  it('finds every DrawingML picture occurrence across body and header, in document order', async () => {
    const file = await buildFixture();
    const occurrences = await scanImageOccurrences('file-1', file);

    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((o) => o.location)).toEqual(['Body', 'Body', 'Header']);
    expect(occurrences.map((o) => o.partPath)).toEqual([
      'word/document.xml',
      'word/document.xml',
      'word/header1.xml',
    ]);
    expect(occurrences.map((o) => o.blipIndex)).toEqual([0, 1, 0]);
  });

  it('resolves each occurrence to its actual embedded media bytes', async () => {
    const file = await buildFixture();
    const occurrences = await scanImageOccurrences('file-1', file);

    expect(occurrences[0].mediaBytes).toEqual(BODY_IMAGE_BYTES);
    expect(occurrences[1].mediaBytes).toEqual(BODY_IMAGE_BYTES);
    expect(occurrences[2].mediaBytes).toEqual(HEADER_IMAGE_BYTES);
  });

  it('records both body occurrences as sharing the same relationship id and media part', async () => {
    const file = await buildFixture();
    const occurrences = await scanImageOccurrences('file-1', file);

    expect(occurrences[0].relationshipId).toBe('rId1');
    expect(occurrences[1].relationshipId).toBe('rId1');
    expect(occurrences[0].mediaPartPath).toBe('word/media/image1.png');
    expect(occurrences[1].mediaPartPath).toBe('word/media/image1.png');
  });
});
