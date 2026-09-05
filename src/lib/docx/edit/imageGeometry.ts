/**
 * Pure sizing math for the three fit modes — never touches image bytes or the DOM. The replacement
 * image is always embedded full and unmodified; sizing is purely a DrawingML geometry instruction
 * (`wp:extent`/`a:ext`/`a:srcRect`), applied by `imageReplace.ts`. Mirrors the ported prototype's
 * `apply_fit` math exactly.
 */

export interface Size {
  width: number;
  height: number;
}

export interface CropRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Uniform-scale letterbox fit: the largest size (preserving the replacement image's own aspect
 *  ratio) that stays within the existing frame. Deliberately mixes frame units (EMU) and image
 *  units (pixels) — only the ratio between the two axes is used, so absolute units cancel out. */
export function computeFitSize(frameWidth: number, frameHeight: number, imageWidth: number, imageHeight: number): Size {
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  return { width: Math.trunc(imageWidth * scale), height: Math.trunc(imageHeight * scale) };
}

/** Crop-rectangle percentages (`a:srcRect` units — thousandths of a percent, 0-100000) that fill
 *  the existing frame without distorting the replacement image, trimming whichever axis it's
 *  proportionally larger on. The frame's own extent is left untouched by this mode. */
export function computeCropRect(frameWidth: number, frameHeight: number, imageWidth: number, imageHeight: number): CropRect {
  const targetRatio = frameWidth / frameHeight;
  const imageRatio = imageWidth / imageHeight;
  const rect: CropRect = { l: 0, t: 0, r: 0, b: 0 };
  if (imageRatio > targetRatio) {
    const trim = Math.max(0, Math.trunc((1 - targetRatio / imageRatio) * 50000));
    rect.l = trim;
    rect.r = trim;
  } else {
    const trim = Math.max(0, Math.trunc((1 - imageRatio / targetRatio) * 50000));
    rect.t = trim;
    rect.b = trim;
  }
  return rect;
}
