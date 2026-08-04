const files = new Map<string, File>();

export function setFile(id: string, file: File): void {
  files.set(id, file);
}

export function getFile(id: string): File | undefined {
  return files.get(id);
}

export function deleteFile(id: string): void {
  files.delete(id);
}
