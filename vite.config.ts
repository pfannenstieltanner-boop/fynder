import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Rust build output; Tauri's own compiler churns these constantly and OneDrive's
      // file locking turns Vite's watcher on them into EBUSY crashes.
      ignored: ['**/src-tauri/**'],
    },
  },
});
