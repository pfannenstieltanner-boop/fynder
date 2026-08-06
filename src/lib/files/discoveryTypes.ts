import type { FileType } from '../../types';

export interface FolderRoot {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
}

export interface DiscoveredFile {
  id: string;
  rootId: string;
  rootName: string;
  name: string;
  relativePath: string;
  parentPath: string;
  fileType: FileType;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle;
}

export interface TermFilter {
  terms: string[];
  mode: 'any' | 'all';
}

export interface DiscoveryFilters {
  folders: TermFilter;
  files: TermFilter;
  combineMode: 'both' | 'either';
  fileTypes: FileType[];
  includeSubfolders: boolean;
}
