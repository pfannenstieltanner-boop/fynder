interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite';
    /** Scopes the browser's "remember where I was" behavior — a fresh id each call stops the
     *  dialog from reopening inside whichever folder was picked last. */
    id?: string;
  }): Promise<FileSystemDirectoryHandle>;
}
