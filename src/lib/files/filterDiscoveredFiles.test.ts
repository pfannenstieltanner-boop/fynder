import { describe, expect, it } from 'vitest';
import type { DiscoveredFile, DiscoveryFilters } from './discoveryTypes';
import { filterDiscoveredFiles } from './filterDiscoveredFiles';

function discovered(name: string, parentPath: string, fileType: DiscoveredFile['fileType'] = 'pdf'): DiscoveredFile {
  return {
    id: `${parentPath}/${name}`,
    rootId: 'root',
    rootName: 'Marketing',
    name,
    relativePath: `${parentPath}/${name}`,
    parentPath,
    fileType,
    size: 100,
    lastModified: 1,
    handle: {} as FileSystemFileHandle,
  };
}

function filters(patch: Partial<DiscoveryFilters> = {}): DiscoveryFilters {
  return {
    folders: { terms: [], mode: 'any' },
    files: { terms: [], mode: 'any' },
    combineMode: 'both',
    fileTypes: ['pdf', 'docx', 'tiff', 'text', 'markdown'],
    includeSubfolders: true,
    ...patch,
  };
}

const files = [
  discovered('Project_Goal_Final.pdf', 'Proposals/Construction'),
  discovered('Campaign_Draft.docx', 'Campaigns/Healthcare', 'docx'),
  discovered('GOAL-notes.txt', 'Archive', 'text'),
];

describe('filterDiscoveredFiles', () => {
  it('matches any of multiple case-insensitive filename terms', () => {
    const result = filterDiscoveredFiles(files, filters({ files: { terms: ['project', 'goal'], mode: 'any' } }));
    expect(result.map((file) => file.name)).toEqual(['Project_Goal_Final.pdf', 'GOAL-notes.txt']);
  });

  it('requires all filename terms when requested', () => {
    const result = filterDiscoveredFiles(files, filters({ files: { terms: ['project', 'goal'], mode: 'all' } }));
    expect(result.map((file) => file.name)).toEqual(['Project_Goal_Final.pdf']);
  });

  it('supports folder-only and combined folder/file rules', () => {
    const both = filters({
      folders: { terms: ['construction'], mode: 'any' },
      files: { terms: ['goal'], mode: 'any' },
      combineMode: 'both',
    });
    expect(filterDiscoveredFiles(files, both)).toHaveLength(1);
    expect(filterDiscoveredFiles(files, { ...both, combineMode: 'either' })).toHaveLength(2);
  });

  it('treats blank term lists as unrestricted and applies file types', () => {
    expect(filterDiscoveredFiles(files, filters({ fileTypes: ['docx'] })).map((file) => file.name)).toEqual([
      'Campaign_Draft.docx',
    ]);
  });
});
