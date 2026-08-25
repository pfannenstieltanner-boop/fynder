import type { FileRecord } from '../../types';

export interface FolderNode {
  /** Unique: root nodes key off `FileSource.rootId` (unique per folder pick, not per name — see
   *  its own doc comment for why), and subfolder nodes extend their parent's key with the path
   *  segment. Two folders that happen to share a display `name` still get distinct nodes. */
  key: string;
  name: string;
  /** Subfolders, sorted alphabetically. */
  children: FolderNode[];
  /** Files directly in this folder (not a subfolder), sorted alphabetically by name. */
  fileIds: string[];
}

export interface FileTree {
  /** One per distinct root folder *pick* (by rootId, not name), sorted alphabetically by name. */
  roots: FolderNode[];
  /** Files with no folder metadata (added via the individual picker, or a loose file drop),
   *  sorted alphabetically by name. Not a folder — nothing to nest them under. */
  otherFileIds: string[];
}

function getOrCreateChild(parent: FolderNode, name: string): FolderNode {
  const existing = parent.children.find((child) => child.name === name);
  if (existing) return existing;
  const created: FolderNode = { key: `${parent.key}/${name}`, name, children: [], fileIds: [] };
  parent.children.push(created);
  return created;
}

export function buildFileTree(files: Record<string, FileRecord>, fileOrder: string[]): FileTree {
  const rootsById = new Map<string, FolderNode>();
  const otherFileIds: string[] = [];

  for (const id of fileOrder) {
    const file = files[id];
    if (!file) continue;
    if (!file.source) {
      otherFileIds.push(id);
      continue;
    }
    const { rootId, rootName, relativePath } = file.source;
    const segments = relativePath.split('/');
    segments.pop(); // the file's own name — only the folder segments above it matter here
    let root = rootsById.get(rootId);
    if (!root) {
      root = { key: rootId, name: rootName, children: [], fileIds: [] };
      rootsById.set(rootId, root);
    }
    let node = root;
    for (const segment of segments) {
      node = getOrCreateChild(node, segment);
    }
    node.fileIds.push(id);
  }

  function sortNode(node: FolderNode): void {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.fileIds.sort((a, b) => (files[a]?.name ?? '').localeCompare(files[b]?.name ?? ''));
    node.children.forEach(sortNode);
  }

  const roots = [...rootsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortNode);
  otherFileIds.sort((a, b) => (files[a]?.name ?? '').localeCompare(files[b]?.name ?? ''));

  return { roots, otherFileIds };
}

export function collectDescendantFileIds(node: FolderNode): string[] {
  const ids = [...node.fileIds];
  for (const child of node.children) ids.push(...collectDescendantFileIds(child));
  return ids;
}

/** Prunes a tree down to only the files in `keep` (plus any folder that still has a kept
 *  descendant after pruning) — used for the sidebar's "matches only" view. Folders left with
 *  nothing underneath are dropped entirely rather than shown empty. */
export function filterTreeToFileIds(tree: FileTree, keep: Set<string>): FileTree {
  function filterNode(node: FolderNode): FolderNode | null {
    const fileIds = node.fileIds.filter((id) => keep.has(id));
    const children = node.children
      .map(filterNode)
      .filter((child): child is FolderNode => child !== null);
    if (fileIds.length === 0 && children.length === 0) return null;
    return { ...node, fileIds, children };
  }

  const roots = tree.roots.map(filterNode).filter((node): node is FolderNode => node !== null);
  const otherFileIds = tree.otherFileIds.filter((id) => keep.has(id));
  return { roots, otherFileIds };
}
