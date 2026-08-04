import { useAppStore } from '../store/appStore';

export default function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        // Sun — shown while dark, click to switch to light.
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="8" y1="0.5" x2="8" y2="2.3" />
            <line x1="8" y1="13.7" x2="8" y2="15.5" />
            <line x1="0.5" y1="8" x2="2.3" y2="8" />
            <line x1="13.7" y1="8" x2="15.5" y2="8" />
            <line x1="2.6" y1="2.6" x2="3.9" y2="3.9" />
            <line x1="12.1" y1="12.1" x2="13.4" y2="13.4" />
            <line x1="2.6" y1="13.4" x2="3.9" y2="12.1" />
            <line x1="12.1" y1="3.9" x2="13.4" y2="2.6" />
          </g>
        </svg>
      ) : (
        // Crescent moon — shown while light, click to switch to dark.
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 9.7A6 6 0 1 1 6.3 2 4.6 4.6 0 0 0 14 9.7Z" />
        </svg>
      )}
    </button>
  );
}
