import { useEffect, useRef, useState } from 'react';
import ReplaceTextModal from './ReplaceTextModal';
import ReplaceImagesModal from './ReplaceImagesModal';

type ActiveModal = 'text' | 'images' | null;

/** The "Document" dropdown and the owner of both Replace modals' open/close state — mirroring
 *  how DropZone owns ChooseFilesModal's boolean. There's no dropdown/menu precedent elsewhere in
 *  the codebase, so the keyboard/click-outside handling here is hand-rolled, matching the style
 *  App.tsx's resize-handle uses for its own custom interactive control. */
export default function DocumentMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    }
  };

  const openModal = (modal: ActiveModal) => {
    setActiveModal(modal);
    setMenuOpen(false);
  };

  return (
    <div className="document-menu">
      <button
        ref={buttonRef}
        type="button"
        className="menu-bar__item"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        Document
      </button>
      {menuOpen && (
        <div ref={menuRef} className="document-menu__panel" role="menu" aria-label="Document" onKeyDown={handleMenuKeyDown}>
          <button type="button" role="menuitem" className="document-menu__option" onClick={() => openModal('text')}>
            Replace Text…
          </button>
          <button type="button" role="menuitem" className="document-menu__option" onClick={() => openModal('images')}>
            Replace Images…
          </button>
        </div>
      )}
      <ReplaceTextModal open={activeModal === 'text'} onClose={() => setActiveModal(null)} />
      <ReplaceImagesModal open={activeModal === 'images'} onClose={() => setActiveModal(null)} />
    </div>
  );
}
