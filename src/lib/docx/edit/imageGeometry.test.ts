import { describe, expect, it } from 'vitest';
import { computeCropRect, computeFitSize } from './imageGeometry';

describe('computeFitSize', () => {
  it('letterboxes a wider-than-frame image within the frame, preserving aspect ratio', () => {
    // Frame is 1000x1000 (square), replacement is 2000x1000 (2:1) — width is the limiting axis.
    const size = computeFitSize(1000, 1000, 2000, 1000);
    expect(size).toEqual({ width: 1000, height: 500 });
  });

  it('letterboxes a taller-than-frame image within the frame, preserving aspect ratio', () => {
    const size = computeFitSize(1000, 1000, 1000, 2000);
    expect(size).toEqual({ width: 500, height: 1000 });
  });

  it('leaves size unchanged when the replacement already matches the frame aspect ratio', () => {
    const size = computeFitSize(800, 600, 400, 300);
    expect(size).toEqual({ width: 800, height: 600 });
  });
});

describe('computeCropRect', () => {
  it('trims left/right when the replacement is proportionally wider than the frame', () => {
    // Frame 1:1, image 2:1 — image is wider, so crop left/right.
    const rect = computeCropRect(1000, 1000, 2000, 1000);
    expect(rect.l).toBeGreaterThan(0);
    expect(rect.l).toBe(rect.r);
    expect(rect.t).toBe(0);
    expect(rect.b).toBe(0);
  });

  it('trims top/bottom when the replacement is proportionally taller than the frame', () => {
    const rect = computeCropRect(1000, 1000, 1000, 2000);
    expect(rect.t).toBeGreaterThan(0);
    expect(rect.t).toBe(rect.b);
    expect(rect.l).toBe(0);
    expect(rect.r).toBe(0);
  });

  it('produces a near-zero crop when aspect ratios already match', () => {
    const rect = computeCropRect(800, 600, 400, 300);
    expect(rect).toEqual({ l: 0, t: 0, r: 0, b: 0 });
  });
});
