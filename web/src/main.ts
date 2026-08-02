// App entry: load a .maxpat (bundled sample, file picker, or drag-drop),
// parse -> IR, render the graph, build the audio engine, and expose transport.

import './objects/audio';   // side-effect: registers audio (MSP) objects
import './objects/control'; // side-effect: registers control (message) objects
import { parseMaxPat } from './parser/maxpat';
import { renderGraph } from './ui/graph';
import { Engine } from './engine/engine';
import { renderTone } from './engine/selftest';
import type { IRPatch } from './ir/types';

const graphEl = document.getElementById('graph')!;
const coverageEl = document.getElementById('coverage')!;
const startBtn = document.getElementById('start') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const sampleSelect = document.getElementById('samples') as HTMLSelectElement;

const selftestBtn = document.getElementById('selftest') as HTMLButtonElement;

let engine: Engine | null = null;
let currentJson: unknown = null;

async function loadPatch(json: unknown, name: string): Promise<void> {
  let patch: IRPatch;
  try {
    patch = parseMaxPat(json);
  } catch (err) {
    coverageEl.textContent = `Parse error: ${(err as Error).message}`;
    return;
  }

  currentJson = json;
  renderGraph(graphEl, patch);

  if (engine) await engine.dispose();
  engine = new Engine();
  const report = engine.build(patch);

  const supportedCount = patch.nodes.length - report.unsupported.length;
  const unsupported = report.unsupported.length
    ? ` · unsupported: ${report.unsupported.join(', ')}`
    : '';
  coverageEl.textContent =
    `${name}: ${patch.nodes.length} objects, ${patch.edges.length} cords` +
    ` · ${supportedCount} playable${unsupported}`;

  startBtn.disabled = false;
  stopBtn.disabled = false;
}

async function loadSample(path: string): Promise<void> {
  // path is relative (e.g. "test-patches/hello_world.maxpat"); resolve against the
  // deploy base so it works at both localhost/ and .../MaxPyLang/app/.
  const res = await fetch(import.meta.env.BASE_URL + path);
  const json = await res.json();
  await loadPatch(json, path.split('/').pop() ?? path);
}

startBtn.addEventListener('click', () => engine?.start());
stopBtn.addEventListener('click', () => engine?.stop());

selftestBtn.addEventListener('click', async () => {
  if (!currentJson) return;
  const { rms, dominantHz } = await renderTone(currentJson, 1);
  const msg = `self-test: rms=${rms.toFixed(4)} dominant≈${dominantHz.toFixed(1)}Hz`;
  coverageEl.textContent = msg;
  // machine-readable hook for automated verification
  (window as any).__selftest = { rms, dominantHz };
  console.log(msg);
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  await loadPatch(JSON.parse(await file.text()), file.name);
});

sampleSelect.addEventListener('change', () => {
  if (sampleSelect.value) void loadSample(sampleSelect.value);
});

// drag-and-drop anywhere
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await loadPatch(JSON.parse(await file.text()), file.name);
});

// auto-load hello_world on first visit
void loadSample('test-patches/hello_world.maxpat');
