import { withOffsets, boxesForRange } from '../pdf/textOffsets';
import type { MatchRange } from '../search/findMatches';
import type { WordBox } from '../../types';

// Lives apart from renderPage.ts (where this used to sit) because it needs nothing from
// pdf.js — it's pure canvas work over WordBoxes. Keeping it separate lets the TIFF preview
// use it without pulling pdf.js into its chunk.

export interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INACTIVE_FILL = 'rgba(254, 240, 138, 0.55)'; // matches MatchSnippet's <mark> yellow (#fef08a)
const ACTIVE_FILL = 'rgba(251, 191, 36, 0.65)';
const ACTIVE_STROKE = '#f59e0b';

let measureCtx: CanvasRenderingContext2D | null = null;

// Real fonts aren't monospaced, so dividing a merged text run's width evenly by character count
// (the previous approach) visibly misplaces the highlight whenever the matched slice's
// characters are narrower/wider than the run's average (very common — spaces, digits, and
// punctuation are usually narrower than letters). Measuring actual glyph widths via Canvas'
// text-measurement API — even against a generic font rather than the PDF's real embedded one —
// gives proportions far closer to the true layout than a flat per-character split.
function measureFraction(text: string, localStart: number, localEnd: number): { fracStart: number; fracEnd: number } {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = '100px sans-serif';
  }
  if (!measureCtx) {
    const total = text.length || 1;
    return { fracStart: localStart / total, fracEnd: localEnd / total };
  }
  const total = measureCtx.measureText(text).width || text.length || 1;
  const before = measureCtx.measureText(text.slice(0, localStart)).width;
  const matched = measureCtx.measureText(text.slice(localStart, localEnd)).width;
  return { fracStart: before / total, fracEnd: (before + matched) / total };
}

/**
 * Draws all highlight rects, drawing `activeMatchIndex`'s rect more prominently (saturated
 * fill + outline) so a single instance reads as "focused" among many on a page (e.g. a repeated
 * term down a schedule/table). Returns that active match's rect (in canvas pixel space), for
 * scroll/zoom-to-match.
 */
export function drawHighlights(
  canvas: HTMLCanvasElement,
  boxes: WordBox[],
  matches: MatchRange[],
  scale: number,
  activeMatchIndex: number,
): HighlightRect | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (matches.length === 0 || boxes.length === 0) return null;

  const offsetBoxes = withOffsets(boxes);
  let activeRect: HighlightRect | null = null;
  matches.forEach((match, matchIndex) => {
    const isActive = matchIndex === activeMatchIndex;
    ctx.fillStyle = isActive ? ACTIVE_FILL : INACTIVE_FILL;
    for (const box of boxesForRange(offsetBoxes, match.start, match.end)) {
      // pdf.js frequently merges several words into one TextItem when they're on the same
      // line (confirmed empirically), so a match can cover only part of a box's text. Narrow
      // the highlight to the matched slice, proportional to measured glyph width within the box.
      const localStart = Math.max(0, match.start - box.start);
      const localEnd = Math.min(box.text.length, match.end - box.start);
      const { fracStart, fracEnd } = measureFraction(box.text, localStart, localEnd);

      const boxWidth = box.x1 - box.x0;
      const x0 = box.x0 + fracStart * boxWidth;
      const x1 = box.x0 + fracEnd * boxWidth;

      const rect = {
        x: x0 * scale,
        y: box.y0 * scale,
        width: (x1 - x0) * scale,
        height: (box.y1 - box.y0) * scale,
      };
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (isActive) {
        ctx.strokeStyle = ACTIVE_STROKE;
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        if (!activeRect) activeRect = rect;
      }
    }
  });
  return activeRect;
}
