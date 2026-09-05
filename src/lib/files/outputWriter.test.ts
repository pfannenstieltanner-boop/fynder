import { describe, expect, it } from 'vitest';
import { resolveOutputFileName } from './outputWriter';

describe('resolveOutputFileName', () => {
  it('returns the desired name unchanged when it is free', () => {
    expect(resolveOutputFileName(new Set(), 'report-replaced-text.docx')).toBe('report-replaced-text.docx');
  });

  it('suffixes with an incrementing counter before the extension on collision', () => {
    const existing = new Set(['report-replaced-text.docx']);
    expect(resolveOutputFileName(existing, 'report-replaced-text.docx')).toBe('report-replaced-text (1).docx');
  });

  it('keeps incrementing past multiple collisions', () => {
    const existing = new Set([
      'report-replaced-text.docx',
      'report-replaced-text (1).docx',
      'report-replaced-text (2).docx',
    ]);
    expect(resolveOutputFileName(existing, 'report-replaced-text.docx')).toBe('report-replaced-text (3).docx');
  });

  it('handles a name with no extension', () => {
    const existing = new Set(['README']);
    expect(resolveOutputFileName(existing, 'README')).toBe('README (1)');
  });
});
