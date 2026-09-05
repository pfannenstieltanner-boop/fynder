import { pickOutputDirectory, supportsWritableDirectoryPicker } from '../lib/files/outputWriter';

export default function OutputLocationPicker({
  directoryHandle,
  onChange,
}: {
  directoryHandle: FileSystemDirectoryHandle | null;
  onChange: (handle: FileSystemDirectoryHandle | null) => void;
}) {
  const supported = supportsWritableDirectoryPicker();

  return (
    <div className="replace-modal__output">
      <button
        type="button"
        onClick={async () => {
          const handle = await pickOutputDirectory();
          if (handle) onChange(handle);
        }}
        disabled={!supported}
      >
        Choose output folder
      </button>
      {directoryHandle && <span className="replace-modal__output-name">{directoryHandle.name}</span>}
      {!supported && (
        <p className="file-discovery__warning">Writing files to a folder is unavailable in this browser.</p>
      )}
    </div>
  );
}
