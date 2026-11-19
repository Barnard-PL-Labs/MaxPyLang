// The docs site's front page: an interactive reference of Max objects, each with a
// maxpylang example you can play. It imports the audio engine from ../web/src as-is.
//
// This folder installs nothing of its own: node_modules here is a symlink to
// ../web/node_modules (see README), so the engine and this page resolve every package
// (vite, typescript, codemirror) to ONE copy. CodeMirror refuses to run with two copies of
// @codemirror/state loaded. Do not alias packages to a folder path: Vite then picks a
// package's CommonJS entry while other importers get its ES module, and bundles both.
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default ({ command }) => ({
  // Served from the site root, https://barnard-pl-labs.github.io/MaxPyLang/
  base: command === 'build' ? '/MaxPyLang/' : '/',
  server: { fs: { allow: [here('..')] } },
  build: {
    outDir: here('../docs'),
    emptyOutDir: false, // docs/ also holds the Sphinx guides and docs/app
    assetsDir: 'reference-assets',
  },
  worker: { format: 'es' },
});
