import { describe, expect, it } from 'vitest';
import { wordBoxFromPdfTextItem } from './textBoxGeometry';

describe('wordBoxFromPdfTextItem', () => {
  it('maps ordinary horizontal text into viewport space', () => {
    expect(
      wordBoxFromPdfTextItem(
        { str: 'RTU-7', transform: [4, 0, 0, 4, 10, 20], width: 18, height: 4 },
        [1, 0, 0, -1, 0, 100],
      ),
    ).toEqual({ text: 'RTU-7', x0: 10, y0: 76, x1: 28, y1: 80 });
  });

  it('keeps text aligned when the page and text transforms rotate in opposite directions', () => {
    // This is the pattern that occurs when a landscape sheet is stored with a rotated PDF page.
    // The rendered text is horizontal, but its source-space Y axis points left/right; assuming
    // `y + height` makes a tall box below the text instead.
    expect(
      wordBoxFromPdfTextItem(
        { str: 'MDP/1,3.5', transform: [0, 3, -3, 0, 10, 20], width: 24, height: 3 },
        [0, 1, 1, 0, 0, 0],
      ),
    ).toEqual({ text: 'MDP/1,3.5', x0: 20, y0: 7, x1: 44, y1: 10 });
  });

  it('uses the correct advance axis for vertical fonts', () => {
    expect(
      wordBoxFromPdfTextItem(
        { str: 'VERT', transform: [3, 0, 0, -3, 10, 20], width: 3, height: 12 },
        [1, 0, 0, 1, 0, 0],
        true,
      ),
    ).toEqual({ text: 'VERT', x0: 10, y0: 8, x1: 13, y1: 20 });
  });
});
