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

import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { maxpyComplete } from './compiler/completions';

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/';

const STARTER = `import maxpylang as mp

# Build a patch, then call save() — the Studio plays whatever you save.
patch = mp.MaxPatch()

pitch = patch.place("slider")[0];            pitch.move(40, 60)   # drag: pitch
mtof  = patch.place("mtof")[0];              mtof.move(40, 130)
osc   = patch.place("cycle~ 220")[0];        osc.move(40, 190)

cut   = patch.place("dial")[0];              cut.move(280, 55)    # drag: cutoff
scale = patch.place("scale 0 127 200 6000")[0]; scale.move(280, 130)
lp    = patch.place("lores~ 1500 3")[0];     lp.move(40, 250)

amp   = patch.place("*~ 0.2")[0];            amp.move(40, 310)
dac   = patch.place("ezdac~")[0];            dac.move(40, 370)

patch.connect([pitch.outs[0], mtof.ins[0]])
patch.connect([mtof.outs[0],  osc.ins[0]])
patch.connect([osc.outs[0],   lp.ins[0]])
patch.connect([cut.outs[0],   scale.ins[0]])
patch.connect([scale.outs[0], lp.ins[1]])
patch.connect([lp.outs[0],    amp.ins[0]])
patch.connect([amp.outs[0],   dac.ins[0]])
patch.connect([amp.outs[0],   dac.ins[1]])

patch.save("my_synth.maxpat")
`;

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
    const json = await compile(view.state.doc.toString());
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

// ── CodeMirror editor (Python mode) ───────────────────────────────────────────
// ⌘/Ctrl+Enter runs; Tab indents (indentWithTab). Created synchronously at load,
// so it exists before the worker's async 'ready' triggers the first run().
const pyLang = python();
const view = new EditorView({
  doc: STARTER,
  parent: document.getElementById('editor')!,
  extensions: [
    basicSetup,
    pyLang,
    oneDark,
    keymap.of([
      indentWithTab,
      { key: 'Mod-Enter', preventDefault: true, run: () => { void run(); return true; } },
    ]),
    // MaxPy completions (Max object names in place("…"), API after a dot),
    // registered alongside the Python language's own keyword completion.
    pyLang.language.data.of({ autocomplete: maxpyComplete }),
  ],
});
