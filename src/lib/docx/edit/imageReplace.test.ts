// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadDocxPackage } from './zipPackage';
import { replaceImagesInPackage, resolveReplacementImageType } from './imageReplace';
import {
  IMAGE_REL_TYPE,
  buildTestDocx,
  pictureParagraph,
  relationshipsXml,
  wordDocumentWithPictures,
} from './testHelpers';

const REPLACEMENT_BYTES = new Uint8Array([9, 9, 9, 9]);
const CONTENT_TYPES_WITHOUT_PNG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
</Types>`;
const CONTENT_TYPES_WITH_PNG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
</Types>`;

async function buildSharedImageFixture(contentTypesXml = CONTENT_TYPES_WITHOUT_PNG) {
  const documentXml = wordDocumentWithPictures(pictureParagraph('rId1', 100000, 100000) + pictureParagraph('rId1', 200000, 100000));
  const documentRels = relationshipsXml([{ id: 'rId1', type: IMAGE_REL_TYPE, target: 'media/image1.png' }]);
  return buildTestDocx({
    textParts: {
      '[Content_Types].xml': contentTypesXml,
      'word/document.xml': documentXml,
      'word/_rels/document.xml.rels': documentRels,
    },
    binaryParts: { 'word/media/image1.png': new Uint8Array([1, 2, 3]) },
  });
}

describe('resolveReplacementImageType', () => {
  it('accepts the four supported extensions', () => {
    expect(resolveReplacementImageType('photo.png')).toEqual({ extension: 'png', contentType: 'image/png' });
    expect(resolveReplacementImageType('photo.JPG')).toEqual({ extension: 'jpg', contentType: 'image/jpeg' });
  });

  it('rejects unsupported extensions', () => {
    expect(() => resolveReplacementImageType('photo.tiff')).toThrow('PNG, JPG, GIF, or BMP');
  });
});

describe('replaceImagesInPackage', () => {
  it('replaces only the targeted occurrence, leaving the other occurrence of the shared image untouched', async () => {
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);

    await replaceImagesInPackage(pkg, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 100,
      imageHeight: 100,
      fitMode: 'stretch',
    });

    const docXml = await pkg.getPartText('word/document.xml');
    const relsXml = await pkg.getPartText('word/_rels/document.xml.rels');

    // Only the first blip's r:embed changed; the second still points at the original relationship.
    const embeds = Array.from(docXml.matchAll(/r:embed="([^"]+)"/g)).map((m) => m[1]);
    expect(embeds[0]).not.toBe('rId1');
    expect(embeds[1]).toBe('rId1');

    // The original relationship is untouched; exactly one new one was added.
    expect(relsXml).toContain('Id="rId1"');
    expect(relsXml).toContain('media/image1.png');
    expect((relsXml.match(/<Relationship /g) ?? []).length).toBe(2);

    expect(await pkg.getPartBytes('word/media/fynder_replace_1.png')).toEqual(REPLACEMENT_BYTES);
  });

  it('registers a new Content_Types Default only when the extension is not already present', async () => {
    const withoutPng = await buildSharedImageFixture(CONTENT_TYPES_WITHOUT_PNG);
    const pkgWithout = await loadDocxPackage(withoutPng);
    await replaceImagesInPackage(pkgWithout, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 100,
      imageHeight: 100,
      fitMode: 'stretch',
    });
    expect(await pkgWithout.getPartText('[Content_Types].xml')).toContain('Extension="png"');

    const withPng = await buildSharedImageFixture(CONTENT_TYPES_WITH_PNG);
    const pkgWith = await loadDocxPackage(withPng);
    await replaceImagesInPackage(pkgWith, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 100,
      imageHeight: 100,
      fitMode: 'stretch',
    });
    // Byte-identical to the original — ensureContentType returned it unchanged, so imageReplace
    // never called setPartText on this part at all.
    expect(await pkgWith.getPartText('[Content_Types].xml')).toBe(CONTENT_TYPES_WITH_PNG);
  });

  it('synthesizes a .rels part when the target part has none', async () => {
    const documentXml = wordDocumentWithPictures(pictureParagraph('rId1'));
    const file = await buildTestDocx({
      textParts: { '[Content_Types].xml': CONTENT_TYPES_WITH_PNG, 'word/document.xml': documentXml },
    });
    const pkg = await loadDocxPackage(file);

    await replaceImagesInPackage(pkg, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 100,
      imageHeight: 100,
      fitMode: 'stretch',
    });

    const relsXml = await pkg.getPartText('word/_rels/document.xml.rels');
    expect(relsXml).toContain('<Relationship ');
    expect(relsXml).toContain('Id="rIdFynderReplace1"');
  });

  it('throws and writes nothing when a selection is stale (r:embed no longer matches)', async () => {
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);

    await expect(
      replaceImagesInPackage(pkg, {
        selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rIdWrong' }],
        replacementBytes: REPLACEMENT_BYTES,
        extension: 'png',
        contentType: 'image/png',
        imageWidth: 100,
        imageHeight: 100,
        fitMode: 'stretch',
      }),
    ).rejects.toThrow('location changed');
  });

  it('aborts the whole document (no partial replacement) when one of several selections is stale', async () => {
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);

    await expect(
      replaceImagesInPackage(pkg, {
        selections: [
          { partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' },
          { partPath: 'word/document.xml', blipIndex: 1, expectedRelationshipId: 'rIdWrong' },
        ],
        replacementBytes: REPLACEMENT_BYTES,
        extension: 'png',
        contentType: 'image/png',
        imageWidth: 100,
        imageHeight: 100,
        fitMode: 'stretch',
      }),
    ).rejects.toThrow();

    // Nothing should have been written for the first (valid) selection either — since a real
    // caller only calls pkg.finalize() after this resolves, the mutated-but-discarded pkg never
    // becomes an output file, matching the ported prototype's whole-document-abort behavior.
    expect(await pkg.getPartText('word/document.xml')).not.toContain('fynder_replace');
  });

  it('applies fit-mode geometry to a realistic pic:blipFill picture (letterboxing wp:extent and a:ext)', async () => {
    // Frame is 100000x100000 (square); replacement image is 200x100 (2:1) — width-limited.
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);
    await replaceImagesInPackage(pkg, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 200,
      imageHeight: 100,
      fitMode: 'fit',
    });
    const docXml = await pkg.getPartText('word/document.xml');
    expect(docXml).toContain('cx="100000" cy="50000"');
  });

  it('applies crop-mode srcRect inside a real pic:blipFill wrapper, not just a:blipFill', async () => {
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);
    await replaceImagesInPackage(pkg, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 200,
      imageHeight: 100,
      fitMode: 'crop',
    });
    const docXml = await pkg.getPartText('word/document.xml');
    expect(docXml).toMatch(/<a:srcRect l="\d+" t="0" r="\d+" b="0"\/>/);
    // The frame's own extent is left untouched by crop mode.
    expect(docXml).toContain('cx="100000" cy="100000"');
  });

  it('leaves wp:extent/a:ext completely untouched in stretch mode', async () => {
    const file = await buildSharedImageFixture();
    const pkg = await loadDocxPackage(file);
    await replaceImagesInPackage(pkg, {
      selections: [{ partPath: 'word/document.xml', blipIndex: 0, expectedRelationshipId: 'rId1' }],
      replacementBytes: REPLACEMENT_BYTES,
      extension: 'png',
      contentType: 'image/png',
      imageWidth: 999,
      imageHeight: 111,
      fitMode: 'stretch',
    });
    const after = await pkg.getPartText('word/document.xml');
    expect(after).toContain('cx="100000" cy="100000"');
    expect(after).toContain('cx="200000" cy="100000"');
  });
});
