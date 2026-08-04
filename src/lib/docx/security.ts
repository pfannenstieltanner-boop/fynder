export const DOCX_RENDER_OPTIONS = {
  className: 'fynder-docx',
  useBase64URL: true,
  renderAltChunks: false,
} as const;

export function isAllowedDocumentLink(rawHref: string, baseUrl: string): boolean {
  if (rawHref.startsWith('#')) return true;
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(rawHref, baseUrl).protocol);
  } catch {
    return false;
  }
}

export function sanitizeRenderedDocument(root: HTMLElement): void {
  root.querySelectorAll('iframe, object, embed').forEach((element) => element.remove());
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const rawHref = anchor.getAttribute('href') ?? '';
    if (!isAllowedDocumentLink(rawHref, window.location.href)) {
      anchor.removeAttribute('href');
      return;
    }
    if (rawHref.startsWith('#')) return;
    const url = new URL(rawHref, window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  });
}

