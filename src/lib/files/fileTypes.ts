import type { FileType } from '../../types';

export function getFileType(file: File): FileType | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.txt')) return 'text';
  if (name.endsWith('.tif') || name.endsWith('.tiff') || file.type === 'image/tiff') return 'tiff';
  return null; // includes legacy .doc — not supported client-side
}

export function isSupportedFile(file: File): boolean {
  return getFileType(file) !== null;
}

export function isLegacyDocFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.doc');
}
