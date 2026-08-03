// MaxPy Studio: write Python in the browser -> Pyodide runs maxpylang -> .maxpat
// JSON -> the existing engine renders & plays it. The player half is the same code
// path as main.ts; only the source is now live Python instead of a bundled file.

import './objects'; // registers all objects (real + stubs)
import { parseMaxPat } from './parser/maxpat';
import { renderGraph } from './ui/graph';
import { Engine } from './engine/engine';
import { renderTone } from './engine/selftest';
import { preloadWorklets } from './runtime/worklet';
import type { IRPatch } from './ir/types';

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/';

const editor = document.getElementById('code') as HTMLTextAreaElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const selftestBtn = document.getElementById('selftest') as HTMLButtonElement;
const graphEl = document.getElementById('graph')!;
const consoleEl = document.getElementById('console')!;

let engine: Engine | null = null;
let lastJson: unknown = null;
let compileId = 0;

function log(msg: string, kind: 'info' | 'error' | 'ok' = 'info') {
  consoleEl.textContent = msg;
  consoleEl.className = kind;
}

// ── Pyodide worker ────────────────────────────────────────────────────────────
const worker = new Worker(new URL('./compiler/pyodide-worker.ts', import.meta.url), { type: 'module' });
let ready = false;
const pending = new Map<number, (json: string) => void>();
const failed = new Map<number, (message: string) => void>();

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'status') log(`Python: ${m.message}`);
  else if (m.type === 'ready') { ready = true; runBtn.disabled = false; log('Python ready — press ⌘/Ctrl+Enter or Run.', 'ok'); void run(); }
  else if (m.type === 'result') pending.get(m.id)?.(m.json);
  else if (m.type === 'error' && m.phase === 'init') log(`Failed to start Python:\n${m.message}`, 'error');
  else if (m.type === 'error') failed.get(m.id)?.(m.message);
};

const wheelUrl = new URL(import.meta.env.BASE_URL + 'py/maxpylang-0.1.1-py3-none-any.whl', location.href).href;
worker.postMessage({ type: 'init', pyodideCdn: PYODIDE_CDN, wheelUrl });

function compile(source: string): Promise<string> {
  const id = ++compileId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    failed.set(id, (msg) => reject(new Error(msg)));
    worker.postMessage({ type: 'compile', id, source });
  }).finally(() => { pending.delete(id); failed.delete(id); }) as Promise<string>;
}

// ── build + play the compiled patch ──────────────────────────────────────────
async function loadPatch(json: unknown): Promise<void> {
  let patch: IRPatch;
  try {
    patch = parseMaxPat(json);
  } catch (err) {
    log(`Parse error: ${(err as Error).message}`, 'error');
    return;
  }
  lastJson = json;
  if (engine) await engine.dispose();
  engine = new Engine();
  await preloadWorklets(engine.ctx);
  const report = engine.build(patch);
  renderGraph(graphEl, patch, report.built);

  const extra = report.stubbed.length ? ` · stubbed: ${report.stubbed.join(', ')}` : '';
  log(`Built ${patch.nodes.length} objects, ${patch.edges.length} cords · ${report.implemented.length} playable${extra}. Press ▶.`, 'ok');
  startBtn.disabled = false;
  stopBtn.disabled = false;
  selftestBtn.disabled = false;
}

async function run(): Promise<void> {
  if (!ready) { log('Python is still loading…'); return; }
  runBtn.disabled = true;
  log('Running…');
  try {
    const json = await compile(editor.value);
    await loadPatch(JSON.parse(json));
  } catch (err) {
    log(String((err as Error).message || err), 'error');
  } finally {
    runBtn.disabled = false;
  }
}

// ── transport ─────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', () => void run());
startBtn.addEventListener('click', () => engine?.start());
stopBtn.addEventListener('click', () => engine?.stop());
selftestBtn.addEventListener('click', async () => {
  if (!lastJson) return;
  const { rms, dominantHz } = await renderTone(lastJson, 1);
  log(`self-test: rms=${rms.toFixed(4)} dominant≈${dominantHz.toFixed(1)}Hz`, 'ok');
});

// ⌘/Ctrl+Enter to run; Tab inserts spaces instead of leaving the editor.
editor.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(); }
  else if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
    editor.selectionStart = editor.selectionEnd = s + 4;
  }
});
