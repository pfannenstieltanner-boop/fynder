// @vitest-environment jsdom
//
// This is the load-bearing spike for the whole batch-edit feature. The Python prototype this
// ports found that `xml.etree.ElementTree`'s serializer drops `xmlns:*` declarations it judges
// "unused" — including ones referenced only via `mc:Ignorable`'s space-separated prefix list
// (compatibility metadata, not real element/attribute usage) — which produces a `document.xml`
// with a dangling `mc:Ignorable` prefix and triggers Word's "needs repair" prompt. Switching to
// `xml.dom.minidom`, which treats namespace declarations as literal attribute nodes and re-emits
// them verbatim regardless of "usage," fixed it. This test proves (or disproves) the working
// hypothesis that browser-native DOMParser/XMLSerializer behaves like minidom, not ElementTree,
// before `paragraphSpans.ts`/`textReplace.ts`/`imageReplace.ts` are built on top of it.
//
// jsdom is a separate implementation from the Chromium engine that actually runs inside Tauri's
// WebView2 — a pass here is strong evidence, not proof. Spot-check once against the real running
// app before trusting this in production.
import { describe, expect, it } from 'vitest';
import { getElementsByTag, parseXmlPart, serializeXmlPart, setPreserveSpace, W_NS } from './xmlSerialization';

const NAMESPACE_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">
  <w:body>
    <w:p>
      <w:r><w:t>hello</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

describe('xmlSerialization namespace preservation', () => {
  it('preserves an mc:Ignorable-referenced xmlns declaration through a mutating round-trip', () => {
    const part = parseXmlPart(NAMESPACE_FIXTURE);
    const [textNode] = getElementsByTag(part, W_NS, 't');
    textNode.textContent = 'goodbye';
    const output = serializeXmlPart(part);

    expect(output).toContain('xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"');
    expect(output).toContain('mc:Ignorable="w14"');
    expect(output).toContain('goodbye');
  });

  it('preserves the declaration through a zero-mutation round-trip with no incidental drift', () => {
    const part = parseXmlPart(NAMESPACE_FIXTURE);
    const output = serializeXmlPart(part);

    expect(output).toContain('xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"');
    expect(output).toContain('mc:Ignorable="w14"');
    expect(output).toContain('<w:t>hello</w:t>');
  });

  it('lets xml:space="preserve" be set on an edited run', () => {
    const part = parseXmlPart(NAMESPACE_FIXTURE);
    const [textNode] = getElementsByTag(part, W_NS, 't');
    textNode.textContent = ' goodbye';
    setPreserveSpace(textNode);
    const output = serializeXmlPart(part);

    expect(output).toMatch(/<w:t[^>]*xml:space="preserve"[^>]*> goodbye<\/w:t>/);
  });
});
