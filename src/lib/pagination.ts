export type PageToken = number | 'ellipsis';

/**
 * Builds a compact pager sequence: page 1, page `total`, and a window of `radius` pages on
 * either side of `current`, with an 'ellipsis' token wherever there's a gap. E.g. current=5,
 * total=10, radius=2 → [1, 'ellipsis', 3, 4, 5, 6, 7, 'ellipsis', 10].
 */
export function buildPageWindow(current: number, total: number, radius = 2): PageToken[] {
  if (total <= 0) return [];
  const pages = new Set<number>([1, total]);
  for (let p = current - radius; p <= current + radius; p++) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const tokens: PageToken[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) tokens.push('ellipsis');
    tokens.push(page);
    previous = page;
  }
  return tokens;
}
