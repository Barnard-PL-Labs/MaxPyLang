import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Dev serves at the root (localhost:5173/). The production build targets GitHub
// Pages, which serves this app from https://barnard-pl-labs.github.io/MaxPyLang/app/,
// and writes straight into the repo's committed docs/ tree so a push publishes it.
//
// ONE app, THREE entries. index.html is the whole tool — canvas, palette, inspector and
// the Python drawer. studio.html and patcher.html are script-free redirect stubs kept
// because both URLs were announced and could be bookmarked; they are listed here for
// exactly one reason, that rollup only emits the HTML files it is given, and a bookmark
// that 404s is a worse outcome than two 500-byte pages.
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
