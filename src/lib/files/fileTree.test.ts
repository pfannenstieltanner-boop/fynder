import { describe, expect, it } from 'vitest';
import { buildFileTree, collectDescendantFileIds } from './fileTree';
import type { FileRecord } from '../../types';

function file(id: string, name: string, source?: FileRecord['source']): FileRecord {
  return {
    id,
    name,
    size: 10,
    lastModified: 1,
    fileType: 'text',
    status: 'done',
    pageCount: 1,
    pages: [],
    processedPageCount: 1,
    pendingOcrCount: 0,
    failedPageCount: 0,
    sourceSummary: 'text',
    includedInSearch: true,
    source,
  };
}

describe('buildFileTree', () => {
  it('nests files under their folder structure and sorts folders before files, alphabetically', () => {
    const files: Record<string, FileRecord> = {
      goal: file('goal', 'Goal.docx', { rootId: 'r1', rootName: 'Marketing', relativePath: 'Goal.docx' }),
      project: file('project', 'Project.pdf', { rootId: 'r1', rootName: 'Marketing', relativePath: 'Proposals/Project.pdf' }),
      appendix: file('appendix', 'Appendix.pdf', {
        rootId: 'r1',
        rootName: 'Marketing',
        relativePath: 'Proposals/Old/Appendix.pdf',
      }),
      loose: file('loose', 'Loose.txt'),
    };
    const tree = buildFileTree(files, ['goal', 'project', 'appendix', 'loose']);

    expect(tree.otherFileIds).toEqual(['loose']);
    expect(tree.roots).toHaveLength(1);
    const marketing = tree.roots[0];
    expect(marketing.name).toBe('Marketing');
    // Folders (Proposals) sort before direct files (Goal.docx) within the same node.
    expect(marketing.children.map((c) => c.name)).toEqual(['Proposals']);
    expect(marketing.fileIds).toEqual(['goal']);

    const proposals = marketing.children[0];
    expect(proposals.fileIds).toEqual(['project']);
    expect(proposals.children.map((c) => c.name)).toEqual(['Old']);
    expect(proposals.children[0].fileIds).toEqual(['appendix']);
  });

  it('merges files from multiple root folders and sorts roots alphabetically', () => {
    const files: Record<string, FileRecord> = {
      a: file('a', 'A.txt', { rootId: 'r-zeta', rootName: 'Zeta', relativePath: 'A.txt' }),
      b: file('b', 'B.txt', { rootId: 'r-alpha', rootName: 'Alpha', relativePath: 'B.txt' }),
    };
    const tree = buildFileTree(files, ['a', 'b']);
    expect(tree.roots.map((r) => r.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('keeps two different root folders that happen to share a name as separate tree nodes', () => {
    const files: Record<string, FileRecord> = {
      a: file('a', 'A.txt', { rootId: 'pick-1', rootName: 'Documents', relativePath: 'A.txt' }),
      b: file('b', 'B.txt', { rootId: 'pick-2', rootName: 'Documents', relativePath: 'B.txt' }),
    };
    const tree = buildFileTree(files, ['a', 'b']);
    expect(tree.roots).toHaveLength(2);
    expect(tree.roots.every((r) => r.name === 'Documents')).toBe(true);
    expect(tree.roots.map((r) => r.key).sort()).toEqual(['pick-1', 'pick-2']);
    expect(tree.roots.map((r) => r.fileIds[0]).sort()).toEqual(['a', 'b']);
  });
});

describe('collectDescendantFileIds', () => {
  it('flattens a folder and all its nested subfolders', () => {
    const files: Record<string, FileRecord> = {
      a: file('a', 'A.txt', { rootId: 'r1', rootName: 'Root', relativePath: 'A.txt' }),
      b: file('b', 'B.txt', { rootId: 'r1', rootName: 'Root', relativePath: 'Sub/B.txt' }),
      c: file('c', 'C.txt', { rootId: 'r1', rootName: 'Root', relativePath: 'Sub/Deeper/C.txt' }),
    };
    const tree = buildFileTree(files, ['a', 'b', 'c']);
    expect(collectDescendantFileIds(tree.roots[0]).sort()).toEqual(['a', 'b', 'c']);
  });
});
