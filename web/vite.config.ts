import { defineConfig } from 'vite';

// Dev serves at the root (localhost:5173/). The production build targets GitHub
// Pages, which serves this app from https://barnard-pl-labs.github.io/MaxPyLang/app/,
// and writes straight into the repo's committed docs/ tree so a push publishes it.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MaxPyLang/app/' : '/',
  build: {
    outDir: '../docs/app',
    emptyOutDir: true,
  },
}));
