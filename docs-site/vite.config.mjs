// The docs site's front page: an interactive reference of Max objects, each with a
// maxpylang example you can play. It imports the audio engine from ../web/src as-is.
//
// This folder installs nothing of its own. Every package (vite, typescript, codemirror)
// resolves from ../web/node_modules, so the engine and this page share ONE copy of each:
// CodeMirror refuses to run with two copies of @codemirror/state loaded.
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const webModules = here('../web/node_modules/');

export default ({ command }) => ({
  // Served from the site root, https://barnard-pl-labs.github.io/MaxPyLang/
  base: command === 'build' ? '/MaxPyLang/' : '/',
  resolve: {
    alias: [
      { find: /^(codemirror|@codemirror\/[^/]+|@lezer\/[^/]+)$/, replacement: webModules + '$1' },
    ],
  },
  server: { fs: { allow: [here('..')] } },
  build: {
    outDir: here('../docs'),
    emptyOutDir: false, // docs/ also holds the Sphinx guides and docs/app
    assetsDir: 'reference-assets',
  },
  worker: { format: 'es' },
});
