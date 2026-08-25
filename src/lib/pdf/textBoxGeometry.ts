import type { WordBox } from '../../types';

interface PdfTextItemGeometry {
  str: string;
  transform: ReadonlyArray<number>;
  width: number;
  height: number;
}

type Point = { x: number; y: number };

/** Compose two PDF affine transforms (the same order used by pdf.js's Util.transform). */
function combineTransforms(first: ReadonlyArray<number>, second: ReadonlyArray<number>): number[] | null {
  if (first.length < 6 || second.length < 6 || [...first, ...second].some((value) => !Number.isFinite(value))) return null;
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function bounds(points: Point[]): Pick<WordBox, 'x0' | 'y0' | 'x1' | 'y1'> {
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

/**
 * Converts one pdf.js text item into a viewport-space bounding box.
 *
 * `TextItem.width` and `.height` are advances in the text item's local axes, not always the
 * page's X/Y axes. Applying the full item transform is essential for rotated pages, rotated
 * text, and skewed PDF content. Treating the values as `x + width, y + height` makes the box
 * appear beside (rather than over) the text on those sheets.
 */
export function wordBoxFromPdfTextItem(
  item: PdfTextItemGeometry,
  viewportTransform: ReadonlyArray<number>,
  vertical = false,
): WordBox {
  const fallback: WordBox = { text: item.str, x0: 0, y0: 0, x1: 0, y1: 0 };
  const transform = combineTransforms(viewportTransform, item.transform);
  if (!transform || !item.str) return fallback;

  const origin = { x: transform[4], y: transform[5] };
  const xAxisLength = Math.hypot(transform[0], transform[1]);
  const yAxisLength = Math.hypot(transform[2], transform[3]);
  if (xAxisLength === 0 || yAxisLength === 0 || !Number.isFinite(item.width) || !Number.isFinite(item.height)) {
    return fallback;
  }

  // Horizontal writing advances along the transformed X axis; vertical writing advances along
  // its transformed Y axis. The other axis supplies the font's cross-section.
  const advance = vertical
    ? { x: (transform[2] / yAxisLength) * item.height, y: (transform[3] / yAxisLength) * item.height }
    : { x: (transform[0] / xAxisLength) * item.width, y: (transform[1] / xAxisLength) * item.width };
  const cross = vertical
    ? { x: (transform[0] / xAxisLength) * item.width, y: (transform[1] / xAxisLength) * item.width }
    : { x: (transform[2] / yAxisLength) * item.height, y: (transform[3] / yAxisLength) * item.height };

  return {
    text: item.str,
    ...bounds([
      origin,
      { x: origin.x + advance.x, y: origin.y + advance.y },
      { x: origin.x + cross.x, y: origin.y + cross.y },
      { x: origin.x + advance.x + cross.x, y: origin.y + advance.y + cross.y },
    ]),
  };
}
