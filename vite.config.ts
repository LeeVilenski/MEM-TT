import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build can be served from any static host or sub-path.
  base: './',
  // three.js alone is ~600 kB; fine for a game.
  build: { chunkSizeWarningLimit: 900 },
});
