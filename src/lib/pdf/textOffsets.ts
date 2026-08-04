import type { WordBox } from '../../types';

export interface OffsetBox extends WordBox {
  start: number;
  end: number;
}

export function withOffsets(boxes: WordBox[]): OffsetBox[] {
  let pos = 0;
  return boxes.map((box) => {
    const start = pos;
    const end = start + box.text.length;
    pos = end + 1; // +1 for the joining space used when building PageData.text
    return { ...box, start, end };
  });
}

export function boxesForRange(offsetBoxes: OffsetBox[], start: number, end: number): OffsetBox[] {
  return offsetBoxes.filter((box) => box.end > start && box.start < end);
}
