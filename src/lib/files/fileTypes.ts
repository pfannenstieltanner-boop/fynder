import type { FileType } from '../../types';

// Single source of truth for "every file type Fynder can search." Both the folder-discovery
// filter (ChooseFilesModal) and the search file-type chips (ResultsColumn) read this list, so
// adding a new supported type here is enough to make it selectable in both places.
export const ALL_FILE_TYPES: FileType[] = ['pdf', 'docx', 'tiff', 'text', 'markdown'];

export const FILE_TYPE_LABELS: Record<FileType, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  tiff: 'TIFF',
  text: 'TXT',
  markdown: 'MD',
};

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
