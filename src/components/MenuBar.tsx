import DocumentMenu from './DocumentMenu';

// A plain in-page bar, deliberately not a Tauri-native menu — the app's window uses the OS title
// bar as-is (no `decorations:false`/menu config in tauri.conf.json), so this is just React/HTML.
export default function MenuBar() {
  return (
    <header className="menu-bar">
      <DocumentMenu />
    </header>
  );
}
