import { useCallback, useState } from 'react';
import { useAppStore } from './store/appStore';
import { SearchProvider } from './contexts/SearchContext';
import MenuBar from './components/MenuBar';
import Sidebar from './components/Sidebar';
import ResultsColumn from './components/ResultsColumn';
import PreviewPane from './components/PreviewPane';

export default function App() {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const previewWidth = useAppStore((s) => s.previewWidth);
  const [resizing, setResizing] = useState<'sidebar' | 'preview' | null>(null);

  // Reads the starting widths imperatively rather than closing over them, so this handler is
  // created once instead of on every width change during a drag.
  const startResize = useCallback(
    (edge: 'sidebar' | 'preview') => (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(edge);
      const startX = e.clientX;
      const store = useAppStore.getState();
      const startSidebar = store.sidebarWidth;
      const startPreview = store.previewWidth;

      const onMove = (ev: MouseEvent) => {
        if (edge === 'sidebar') {
          useAppStore.getState().setSidebarWidth(startSidebar + (ev.clientX - startX));
        } else {
          useAppStore.getState().setPreviewWidth(startPreview - (ev.clientX - startX));
        }
      };
      const onUp = () => {
        setResizing(null);
        // Persist once, at the end — not on every mousemove.
        useAppStore.getState().persistPaneWidths();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [],
  );

  const resizeByKeyboard = useCallback((edge: 'sidebar' | 'preview', delta: number) => {
    const store = useAppStore.getState();
    if (edge === 'sidebar') store.setSidebarWidth(store.sidebarWidth + delta);
    else store.setPreviewWidth(store.previewWidth + delta);
    useAppStore.getState().persistPaneWidths();
  }, []);

  return (
    <SearchProvider>
      <div className="app-layout">
        <MenuBar />
        <div className="app-shell">
          <Sidebar width={sidebarWidth} />
          <div
            className={`resize-handle${resizing === 'sidebar' ? ' resize-handle--active' : ''}`}
            onMouseDown={startResize('sidebar')}
            role="separator"
            aria-label="Resize file sidebar"
            aria-orientation="vertical"
            aria-valuemin={170}
            aria-valuemax={640}
            aria-valuenow={Math.round(sidebarWidth)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                resizeByKeyboard('sidebar', e.key === 'ArrowLeft' ? -10 : 10);
              }
            }}
          />
          <ResultsColumn />
          <div
            className={`resize-handle${resizing === 'preview' ? ' resize-handle--active' : ''}`}
            onMouseDown={startResize('preview')}
            role="separator"
            aria-label="Resize preview pane"
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={900}
            aria-valuenow={Math.round(previewWidth)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                resizeByKeyboard('preview', e.key === 'ArrowLeft' ? 10 : -10);
              }
            }}
          />
          <PreviewPane width={previewWidth} />
        </div>
      </div>
    </SearchProvider>
  );
}
