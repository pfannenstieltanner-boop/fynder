// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadDocxPackage } from './zipPackage';
import { replaceTextInPackage } from './textReplace';
import { buildTestDocx, wordDocument } from './testHelpers';

describe('replaceTextInPackage', () => {
  it('removes a match split across differently-formatted runs', async () => {
    const documentXml = wordDocument(
      '<w:p><w:r><w:t>un</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>wanted</w:t></w:r><w:r><w:t> stays.</w:t></w:r></w:p>',
    );
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: false });

    expect(result.matchCount).toBe(1);
    expect(result.changedParts).toEqual(['word/document.xml']);
    const output = await pkg.getPartText('word/document.xml');
    expect(output).toContain('<w:t>');
    expect(output).not.toContain('unwanted');
    expect(output).toMatch(/stays\.<\/w:t>/);
  });

  it('respects whole-word boundaries, leaving a superstring match untouched', async () => {
    const documentXml = wordDocument(
      '<w:p><w:r><w:t>unwantedness stays; unwanted goes.</w:t></w:r></w:p>',
    );
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: true });

    expect(result.matchCount).toBe(1);
    const output = await pkg.getPartText('word/document.xml');
    expect(output).toContain('unwantedness stays;  goes.');
  });

  it('sets xml:space="preserve" when an edit leaves a run starting or ending with whitespace', async () => {
    const documentXml = wordDocument(
      '<w:p><w:r><w:t>Hello unwanted</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p>',
    );
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: false });

    expect(result.matchCount).toBe(1);
    const output = await pkg.getPartText('word/document.xml');
    expect(output).toContain('<w:t> world</w:t>');
    expect(output).toMatch(/<w:t[^>]*xml:space="preserve"[^>]*>Hello <\/w:t>/);
  });

  it('does not join text separated by a tab into one match', async () => {
    const documentXml = wordDocument('<w:p><w:r><w:t>un</w:t><w:tab/><w:t>wanted</w:t></w:r></w:p>');
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: false });

    expect(result.matchCount).toBe(0);
    expect(result.changedParts).toEqual([]);
  });

  it('scans header and footer parts in addition to the main document', async () => {
    const documentXml = wordDocument('<w:p><w:r><w:t>nothing here</w:t></w:r></w:p>');
    const headerXml = wordDocument('<w:p><w:r><w:t>unwanted header</w:t></w:r></w:p>');
    const footerXml = wordDocument('<w:p><w:r><w:t>unwanted footer</w:t></w:r></w:p>');
    const file = await buildTestDocx({
      textParts: {
        'word/document.xml': documentXml,
        'word/header1.xml': headerXml,
        'word/footer1.xml': footerXml,
      },
    });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: false });

    expect(result.matchCount).toBe(2);
    expect(result.changedParts.sort()).toEqual(['word/footer1.xml', 'word/header1.xml']);
  });

  it('leaves a part with zero matches byte-identical (not marked changed)', async () => {
    const documentXml = wordDocument('<w:p><w:r><w:t>nothing to see here</w:t></w:r></w:p>');
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, { find: 'unwanted', replaceWith: '', matchCase: false, wholeWord: false });

    expect(result.matchCount).toBe(0);
    expect(result.changedParts).toEqual([]);
    expect(await pkg.getPartText('word/document.xml')).toBe(documentXml);
  });

  it('inserts non-empty replacement text once, not once per split run', async () => {
    const documentXml = wordDocument('<w:p><w:r><w:t>un</w:t></w:r><w:r><w:t>wanted</w:t></w:r></w:p>');
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });
    const pkg = await loadDocxPackage(file);

    const result = await replaceTextInPackage(pkg, {
      find: 'unwanted',
      replaceWith: 'welcome',
      matchCase: false,
      wholeWord: false,
    });

    expect(result.matchCount).toBe(1);
    const output = await pkg.getPartText('word/document.xml');
    expect((output.match(/welcome/g) ?? []).length).toBe(1);
  });

  it('is case-insensitive by default and case-sensitive when requested', async () => {
    const documentXml = wordDocument('<w:p><w:r><w:t>Unwanted and unwanted</w:t></w:r></w:p>');
    const file = await buildTestDocx({ textParts: { 'word/document.xml': documentXml } });

    const insensitive = await replaceTextInPackage(await loadDocxPackage(file), {
      find: 'unwanted',
      replaceWith: '',
      matchCase: false,
      wholeWord: false,
    });
    expect(insensitive.matchCount).toBe(2);

    const sensitive = await replaceTextInPackage(await loadDocxPackage(file), {
      find: 'unwanted',
      replaceWith: '',
      matchCase: true,
      wholeWord: false,
    });
    expect(sensitive.matchCount).toBe(1);
  });
});
