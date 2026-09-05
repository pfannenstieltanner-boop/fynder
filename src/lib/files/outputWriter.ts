/**
 * Writes batch-replace output files to a user-chosen folder — the app's first write-capable
 * path; everything else in Fynder only reads and previews. Loaded files may have come from drag-
 * and-drop or a plain `<input type=file>`, neither of which carries a directory handle, so there
 * is no reliable "write back near the original" option — output always goes to a freshly chosen
 * folder, and originals are never opened for writing.
 */

export function supportsWritableDirectoryPicker(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function pickOutputDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'fynder-replace-output' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/** Pure — appends " (1)", " (2)", ... before the extension until the name is free of `existingNames`. */
export function resolveOutputFileName(existingNames: ReadonlySet<string>, desiredName: string): string {
  if (!existingNames.has(desiredName)) return desiredName;
  const dot = desiredName.lastIndexOf('.');
  const base = dot > 0 ? desiredName.slice(0, dot) : desiredName;
  const ext = dot > 0 ? desiredName.slice(dot) : '';
  let n = 1;
  let candidate = `${base} (${n})${ext}`;
  while (existingNames.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

async function listExistingNames(dirHandle: FileSystemDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const handle of dirHandle.values()) {
    names.add(handle.name);
  }
  return names;
}

/** Writes `blob` under `desiredName`, collision-suffixed against the directory's current
 *  contents, and returns the name actually written. */
export async function writeOutputFile(
  dirHandle: FileSystemDirectoryHandle,
  desiredName: string,
  blob: Blob,
): Promise<string> {
  const existingNames = await listExistingNames(dirHandle);
  const finalName = resolveOutputFileName(existingNames, desiredName);
  const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return finalName;
}
