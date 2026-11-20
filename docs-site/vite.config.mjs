// The docs site's front page: an interactive reference of Max objects, each with a
// maxpylang example you can play. It imports the audio engine from ../web/src as-is.
//
// This folder installs nothing of its own: node_modules here is a symlink to
// ../web/node_modules (see README), so the engine and this page resolve every package
// (vite, typescript, codemirror) to ONE copy. CodeMirror refuses to run with two copies of
// @codemirror/state loaded. Do not alias packages to a folder path: Vite then picks a
// package's CommonJS entry while other importers get its ES module, and bundles both.
import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// In development, links to the guides (built by `npm run guides` into docs/html) and
// to MaxPyStudio (docs/app) would otherwise fall back to this page. Serve them from disk.
const TYPES = { '.html': 'text/html', '.txt': 'text/plain', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.whl': 'application/octet-stream', '.wav': 'audio/wav', '.maxpat': 'application/json' };
const siblingPages = {
  name: 'serve-guides-in-dev',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]);
      if (path === '/' || /^\/(@|src\/|node_modules\/|py\/)/.test(path)) return next();
      for (const root of [here('../docs/html'), here('../docs')]) {
        let file = join(root, path);
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          return createReadStream(file).pipe(res);
        }
      }
      if (/\.(html|txt)$/.test(path)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        return res.end(`${path} not found. Build the guides first: npm --prefix docs-site run guides`);
      }
      next();
    });
  },
};

export default ({ command }) => ({
  // Served from the site root, https://barnard-pl-labs.github.io/MaxPyLang/
  base: command === 'build' ? '/MaxPyLang/' : '/',
  plugins: [siblingPages],
  server: { fs: { allow: [here('..')] } },
  build: {
    outDir: here('../docs'),
    emptyOutDir: false, // docs/ also holds the Sphinx guides and docs/app
    assetsDir: 'reference-assets',
  },
  worker: { format: 'es' },
});
