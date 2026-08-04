export const MIN_CHARS_FOR_TEXT_PAGE = 10;
export const MIN_WORDS_FOR_TEXT_PAGE = 3;
export const OCR_RENDER_SCALE = 2;

export function isPageTextSufficient(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (trimmed.length < MIN_CHARS_FOR_TEXT_PAGE) return false;
  const words = trimmed.match(/[A-Za-z0-9]{2,}/g) ?? [];
  return words.length >= MIN_WORDS_FOR_TEXT_PAGE;
}
