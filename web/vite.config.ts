import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dev serves at the root (localhost:5173/). The production build targets GitHub
// Pages, which serves this app from https://barnard-pl-labs.github.io/MaxPyLang/app/,
// and writes straight into the repo's committed docs/ tree so a push publishes it.
// Two pages: the player (index.html) and the MaxPy Studio (studio.html); the Studio
// pulls Pyodide, so it's a separate entry the player never loads.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MaxPyLang/app/' : '/',
  build: {
    outDir: '../docs/app',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        studio: resolve(__dirname, 'studio.html'),
      },
    },
  },
  worker: { format: 'es' },
}));
