/**
 * Registry for preview-side document caches (pdf.js proxies, decoded TIFF frames).
 *
 * The store needs to evict those caches when a file is removed, but importing the
 * cache modules directly would drag pdf.js and utif2 into the initial bundle for
 * the sake of two cleanup calls. Instead each cache module registers itself when
 * it loads — which only happens once a preview of that type is actually opened.
 * If a module never loaded, it has no cache to evict, so there's nothing to miss.
 */

type Evictor = (fileId: string) => void;

const evictors = new Set<Evictor>();

export function registerPreviewCache(evict: Evictor): void {
  evictors.add(evict);
}

export function evictPreviewCaches(fileId: string): void {
  for (const evict of evictors) evict(fileId);
}
