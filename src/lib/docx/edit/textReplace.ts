/**
 * Ports the prototype's batch text removal/replacement, generalized to accept an optional
 * replacement string (the original only removed matched text; an empty `replaceWith` reproduces
 * that exact behavior). Edits only plain text-run content (`<w:t>` values) — it never introduces
 * new elements, hyperlinks, or attributes capable of active content, so it doesn't need to go
 * through `src/lib/docx/security.ts`'s render-time sanitization, which governs the separate
 * mammoth render path this feature bypasses entirely.
 */
import { parseXmlPart, serializeXmlPart, setPreserveSpace, type XmlPart } from './xmlSerialization';
import { buildParagraphSpans, getParagraphs } from './paragraphSpans';
import { TEXT_PART_RE, type DocxPackage } from './zipPackage';

export interface TextReplaceOptions {
  find: string;
  replaceWith: string;
  matchCase: boolean;
  wholeWord: boolean;
}

export interface TextReplaceResult {
  matchCount: number;
  changedParts: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(options: TextReplaceOptions): RegExp {
  let source = escapeRegExp(options.find);
  if (options.wholeWord) source = `(?<!\\w)${source}(?!\\w)`;
  return new RegExp(source, options.matchCase ? 'g' : 'gi');
}

/** Applies every match in one paragraph and returns how many matches were found. A match that
 *  spans multiple `<w:t>` runs gets the replacement text inserted into only the first (lowest-
 *  offset) run it overlaps; every other run it overlaps has its overlapping portion removed with
 *  no insertion, so the replacement text isn't duplicated once per run. */
function applyReplacementsToParagraph(paragraph: Element, pattern: RegExp, replaceWith: string): number {
  const { combined, spans } = buildParagraphSpans(paragraph);
  const matches = Array.from(combined.matchAll(pattern));
  if (matches.length === 0) return 0;

  const editsByElement = new Map<Element, Array<{ localStart: number; localEnd: number; insertText: string }>>();

  for (const match of matches) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    let insertedYet = false;

    for (const span of spans) {
      if (span.end <= matchStart || span.start >= matchEnd) continue;
      const localStart = Math.max(0, matchStart - span.start);
      const localEnd = Math.min(span.end - span.start, matchEnd - span.start);
      if (localStart >= localEnd) continue;
      const insertText = insertedYet ? '' : replaceWith;
      insertedYet = true;
      const edits = editsByElement.get(span.element) ?? [];
      edits.push({ localStart, localEnd, insertText });
      editsByElement.set(span.element, edits);
    }
  }

  // Splice each affected node in reverse local-offset order, so an earlier edit's offsets in
  // that node stay valid while a later (higher-offset) edit is applied first.
  for (const [element, edits] of editsByElement) {
    edits.sort((a, b) => b.localStart - a.localStart);
    let text = element.textContent ?? '';
    for (const edit of edits) {
      text = text.slice(0, edit.localStart) + edit.insertText + text.slice(edit.localEnd);
    }
    element.textContent = text;
    if (text.length > 0 && (/^\s/.test(text) || /\s$/.test(text))) {
      setPreserveSpace(element);
    }
  }

  return matches.length;
}

function replaceTextInPart(part: XmlPart, pattern: RegExp, replaceWith: string): number {
  let partMatchCount = 0;
  for (const paragraph of getParagraphs(part)) {
    partMatchCount += applyReplacementsToParagraph(paragraph, pattern, replaceWith);
  }
  return partMatchCount;
}

export async function replaceTextInPackage(
  pkg: DocxPackage,
  options: TextReplaceOptions,
): Promise<TextReplaceResult> {
  if (options.find.length === 0) return { matchCount: 0, changedParts: [] };

  const pattern = buildPattern(options);
  const changedParts: string[] = [];
  let matchCount = 0;

  for (const partPath of pkg.listPartsMatching(TEXT_PART_RE)) {
    const xmlText = await pkg.getPartText(partPath);
    const part = parseXmlPart(xmlText);
    const partMatchCount = replaceTextInPart(part, pattern, options.replaceWith);
    if (partMatchCount > 0) {
      pkg.setPartText(partPath, serializeXmlPart(part));
      changedParts.push(partPath);
      matchCount += partMatchCount;
    }
  }

  return { matchCount, changedParts };
}
