import { describe, expect, it } from 'vitest';
import { DOCX_RENDER_OPTIONS, isAllowedDocumentLink } from './security';

describe('DOCX rendering security', () => {
  it('keeps AltChunk HTML disabled', () => {
    expect(DOCX_RENDER_OPTIONS.renderAltChunks).toBe(false);
  });

  it('rejects active and data URL schemes', () => {
    const base = 'https://fynder.local/';
    expect(isAllowedDocumentLink('javascript:alert(1)', base)).toBe(false);
    expect(isAllowedDocumentLink('data:text/html,<script>alert(1)</script>', base)).toBe(false);
    expect(isAllowedDocumentLink('https://example.com/', base)).toBe(true);
    expect(isAllowedDocumentLink('#section', base)).toBe(true);
  });
});

