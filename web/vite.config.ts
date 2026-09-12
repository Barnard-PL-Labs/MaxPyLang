import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dev serves at the root (localhost:5173/). The production build targets GitHub
// Pages, which serves this app from https://barnard-pl-labs.github.io/MaxPyLang/app/,
// and writes straight into the repo's committed docs/ tree so a push publishes it.
// Three pages, each with its own weight so no page pays for another's: the player
// (index.html), the MaxPy Studio (studio.html), which pulls Pyodide, and the visual
// patcher (patcher.html), which pulls the generated box specs and object docs.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MaxPyLang/app/' : '/',
  build: {
    outDir: '../docs/app',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        studio: resolve(__dirname, 'studio.html'),
        patcher: resolve(__dirname, 'patcher.html'),
      },
    },
  },
  worker: { format: 'es' },
}));
