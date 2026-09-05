import { W_NS, type XmlPart, getElementsByTag } from './xmlSerialization';

/** Break-type elements act as barriers: two `<w:t>` runs separated by one of these must never be
 *  read as adjoining text (e.g. "foo<w:tab/>bar" must not match a pattern for "foobar"), so each
 *  one contributes a NUL sentinel to the combined string with no associated span — a match can
 *  still technically span it, but since no `<w:t>` span covers that position, nothing gets edited
 *  there, which is what keeps tab/line-break-separated text from being silently joined. */
const BREAK_LOCAL_NAMES = new Set(['tab', 'br', 'cr', 'noBreakHyphen', 'softHyphen']);
const BREAK_BARRIER = '\x00';

export interface TextNodeSpan {
  element: Element;
  start: number;
  end: number;
}

export interface ParagraphSpans {
  combined: string;
  spans: TextNodeSpan[];
}

/** Every `<w:p>` in the part, in document order — including ones nested inside a `<w:txbxContent>`
 *  text box, which is itself nested inside a run within an outer paragraph. Each paragraph is
 *  processed independently: `buildParagraphSpans` stops descending at a nested `<w:p>` boundary so
 *  a text box's contents aren't double-counted into its containing paragraph's combined text. */
export function getParagraphs(part: XmlPart): Element[] {
  return getElementsByTag(part, W_NS, 'p');
}

/** Walks one paragraph's descendants in document order, concatenating `<w:t>` text into one
 *  string and recording each node's `[start,end)` span within it, with a barrier character (no
 *  span) inserted at each break element. Does not descend into a nested `<w:p>` (text box
 *  contents), since that paragraph is walked separately by the caller. */
export function buildParagraphSpans(paragraph: Element): ParagraphSpans {
  const spans: TextNodeSpan[] = [];
  let combined = '';

  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const isWordNs = child.namespaceURI === W_NS;
      if (isWordNs && child.localName === 'p') {
        continue;
      }
      if (isWordNs && child.localName === 't') {
        const start = combined.length;
        combined += child.textContent ?? '';
        spans.push({ element: child, start, end: combined.length });
        continue;
      }
      if (isWordNs && BREAK_LOCAL_NAMES.has(child.localName)) {
        combined += BREAK_BARRIER;
        continue;
      }
      walk(child);
    }
  };

  walk(paragraph);
  return { combined, spans };
}
