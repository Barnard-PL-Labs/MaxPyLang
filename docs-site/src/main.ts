// The MaxPyLang object reference: a Hydra-style page where each Max object has a
// maxpylang example you can play, edit and run in the browser.
//
// Route: #objects/<name>/<example>, e.g. #objects/cycle~/1 (Hydra: #functions/noise/0).

import './style.css';
import { play, stop, playing, onChange, builtWidget } from './player';
import { categories, findEntry, pyArg, type Entry, type Example } from './entries';
import { compile, lastLine, LoadError, onStatus, pythonLoaded } from './compiler';
import { mountEditor } from './editor';
import { mountScope } from './scope';
import { PatchPane, layoutForReading } from './patchview';
import { buildPermalink } from '../../web/src/ui/permalink';
import type { EditorView } from 'codemirror';

const BASE = import.meta.env.BASE_URL;
// MaxPyStudio is published next to this page, at /MaxPyLang/app/. In development, link to the live one.
const STUDIO = import.meta.env.DEV ? 'https://barnard-pl-labs.github.io/MaxPyLang/app/' : new URL(BASE + 'app/', location.href).href;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const route = (name: string, i = 0) => `#objects/${encodeURIComponent(name)}/${i}`;

// ---------- page shell ----------

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="top">
    <h1><a href="${BASE}">MaxPyLang</a> <span>object reference</span></h1>
    <nav>
      <a href="${BASE}guide/getting-started.html">Guide</a>
      <a href="${BASE}API/API.html">API</a>
      <a href="${BASE}app/">MaxPyStudio</a>
      <a href="${BASE}llms-full.txt" title="These docs as one Markdown file, for coding agents">llms-full.txt</a>
      <a href="https://github.com/Barnard-PL-Labs/MaxPyLang">GitHub</a>
    </nav>
  </header>
  <main class="layout">
    <section class="list">
      <p class="intro">
        <a href="https://github.com/Barnard-PL-Labs/MaxPyLang">MaxPyLang</a> writes Max patches from Python.
        Click an object to see how to place it, then press ▶ to hear the example. Every example is real
        maxpylang code: edit it and run it again. (New here? Start with the
        <a href="${BASE}guide/getting-started.html">getting started guide</a>.)
      </p>
      <input id="search" type="search" placeholder="Search objects (cycle~, filter, metro…)" autocomplete="off" />
      <div id="cats"></div>
    </section>
    <aside class="panel" id="panel" hidden></aside>
  </main>`;

const catsEl = document.getElementById('cats')!;
const panel = document.getElementById('panel')!;
const search = document.getElementById('search') as HTMLInputElement;

function renderList(filter = ''): void {
  const q = filter.trim().toLowerCase();
  catsEl.innerHTML = categories().map((c) => {
    const entries = q
      ? c.entries.filter((e) => e.name.toLowerCase().includes(q) || e.digest.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      : c.entries;
    if (!entries.length) return '';
    const chips = entries.map((e) => {
      const cls = ['chip', e.examples.length ? 'has-ex' : '', e.playable ? '' : 'max-only'].join(' ');
      const tip = esc(e.digest + (e.playable ? '' : ' (Max only)'));
      return `<a class="${cls}" style="--c:${e.color}" href="${route(e.name)}" title="${tip}">${esc(e.name)}</a>`;
    }).join('');
    const open = !c.collapsed || q ? ' open' : '';
    return `<details class="cat"${open}><summary><h2>${esc(c.name)}</h2><span class="count">${entries.length}</span></summary>
      <p class="blurb">${esc(c.blurb)}</p><div class="chips">${chips}</div></details>`;
  }).join('');
}
search.addEventListener('input', () => renderList(search.value));

// ---------- the panel ----------

let editor: EditorView | null = null;
let stopScope: (() => void) | null = null;
let pane: PatchPane | null = null;
let shown: { entry: Entry; example: Example | null; key: string; code: string; patch: unknown } | null = null;

function usageHtml(e: Entry): string {
  const args = e.args.map((a) => {
    const n = esc(pyArg(a.name));
    return a.optional ? `<span class="opt" title="optional, ${esc(a.type)}">${n}</span>` : `<span title="${esc(a.type)}">${n}</span>`;
  }).join(', ');
  const call = e.stub ? `${esc(e.stub)}( ${args} )` : `patch.place("${esc(e.name)}${e.args.length ? ' …' : ''}")`;
  const lines = [`<code class="usage">${call}</code>`];
  if (e.stub) lines.push(`<p class="hint">from <code>maxpylang.objects</code>; or as text: <code>patch.place("${esc(e.name)}${e.args.length ? ' …' : ''}")</code></p>`);
  if (!e.known) lines.push(`<p class="warn">maxpylang has no data for <code>${esc(e.name)}</code> yet: <code>place()</code> gives an unknown object with no inlets. See <a href="${BASE}guide/known-issues.html">known issues</a>.</p>`);
  else if (e.required.length) lines.push(`<p class="warn">maxpylang needs ${e.required.map((r) => `<code>${esc(pyArg(r))}</code>`).join(' and ')}: a bare <code>${esc(e.stub ?? e.name)}</code> is placed as an unknown object, with no warning.</p>`);
  if (!e.playable) lines.push(`<p class="warn">Plays in Max, but not in this browser player yet.</p>`);
  return lines.join('');
}

function portsHtml(e: Entry): string {
  const row = (kind: string, ps: Entry['inlets']) => ps.map((p) =>
    `<tr><td>${kind} ${p.index}</td><td><span class="rate ${p.domain}">${p.domain === 'signal' ? 'audio' : p.domain}</span></td><td>${esc(p.text)}</td></tr>`).join('');
  if (!e.inlets.length && !e.outlets.length) return '';
  return `<table class="ports">${row('in', e.inlets)}${row('out', e.outlets)}</table>`;
}

function showPanel(name: string, index: number): void {
  const entry = findEntry(name);
  if (!entry) { panel.hidden = true; return; }
  const example = entry.examples[index] ?? entry.examples[0] ?? null;
  const key = example ? `${entry.name}/${example.index}` : entry.name;
  shown = { entry, example, key, code: example?.code ?? '', patch: example?.patch ?? null };

  editor?.destroy(); editor = null;
  stopScope?.(); stopScope = null;
  pane?.destroy(); pane = null;
  document.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
  document.querySelectorAll(`.chip[href="${CSS.escape(route(entry.name))}"]`).forEach((c) => c.classList.add('active'));

  const tabs = entry.examples.map((x) =>
    `<a class="tab${x === example ? ' on' : ''}" href="${route(entry.name, x.index)}" title="${esc(x.title)}">${x.index}</a>`).join('');

  panel.hidden = false;
  panel.style.setProperty('--c', entry.color);
  panel.innerHTML = `
    <a class="close" href="#" title="Close">✖</a>
    <h2 class="name">${esc(entry.name)}</h2>
    <p class="digest">${esc(entry.digest)}</p>
    <h3>Usage</h3>
    ${usageHtml(entry)}
    ${example ? `
      <h3>Example</h3>
      <div class="visual">
        <div class="patch-host" aria-label="The example's patch"></div>
        <canvas class="scope" aria-label="Live waveform and spectrum"></canvas>
      </div>
      <p class="patch-note">The patch this code makes, arranged top to bottom for reading. Drag to move it or its boxes; ⌘/Ctrl + scroll to zoom.</p>
      <div class="bar">
        <div class="tabs">${tabs}</div>
        <div class="buttons">
          <button class="play" title="Play / stop (Ctrl+Enter)">▶</button>
          <button class="reset" title="Undo your edits">↺</button>
          <button class="copy" title="Copy the code">⧉</button>
          <button class="studio" title="Open this patch in MaxPyStudio">↗</button>
        </div>
      </div>
      <p class="ex-title"><b>${esc(example.title)}</b> ${esc(example.note)}</p>
      <div class="editor"></div>
      <p class="status">Edit the code and press ▶ or Ctrl+Enter to run it.</p>`
    : `<p class="none">No example for this object yet.</p>`}
    ${entry.description ? `<h3>About</h3><p class="desc">${esc(entry.description)}</p>` : ''}
    ${portsHtml(entry)}`;

  panel.querySelector('.close')!.addEventListener('click', (ev) => { ev.preventDefault(); location.hash = ''; });
  if (!example) return;

  const status = panel.querySelector('.status') as HTMLElement;
  const setStatus = (text: string, kind = '') => { status.textContent = text; status.className = 'status ' + kind; };
  // Box ids (obj-1, obj-2…) repeat across patches, so mount the engine's live widgets
  // only while this example is the one playing.
  pane = new PatchPane(panel.querySelector('.patch-host') as HTMLElement, {
    widgetFor: (id) => (playing() === key ? builtWidget(id) : undefined),
    onExpand: () => openExpanded(entry, key, () => shown?.code ?? example.code, () => shown?.patch ?? example.patch),
  });
  const drawPatch = (p: unknown) => pane?.show(p);
  drawPatch(example.patch);

  editor = mountEditor(panel.querySelector('.editor') as HTMLElement, example.code, {
    onRun: () => void runOrStop(true),
    onChange: (text) => { if (shown) shown.code = text; },
  });
  stopScope = mountScope(panel.querySelector('.scope') as HTMLCanvasElement, () => entry.color, () => playing() === key);

  const playBtn = panel.querySelector('.play') as HTMLButtonElement;
  const syncButton = () => {
    playBtn.textContent = playing() === key ? '■' : '▶';
    pane?.refreshWidgets();
  };
  syncButton();

  async function runOrStop(forceRun = false): Promise<void> {
    if (!shown) return;
    if (playing() === key && !forceRun) { await stop(); return; }
    const edited = shown.code !== example!.code;
    try {
      let patch = example!.patch;
      if (edited) {
        setStatus(pythonLoaded() ? 'Running your code…' : 'Loading Python in the browser (a few seconds, first time only)…');
        patch = await compile(shown.code);
        drawPatch(patch);
      }
      shown.patch = patch;
      await play(key, patch);
      setStatus(edited ? 'Playing your edited code.' : 'Playing. Edit the code and press ▶ or Ctrl+Enter to run it.', 'ok');
    } catch (err) {
      if (err instanceof LoadError) console.warn('Python failed to start:', err.detail);
      setStatus(err instanceof LoadError ? err.message : lastLine(String((err as Error).message ?? err)), 'error');
    }
  }

  playBtn.addEventListener('click', () => void runOrStop());
  panel.querySelector('.reset')!.addEventListener('click', () => {
    editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: example.code } });
    if (shown) shown.patch = example.patch;
    drawPatch(example.patch);
    setStatus('Back to the original example.');
  });
  panel.querySelector('.copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(shown?.code ?? example.code);
    setStatus('Copied.');
  });
  panel.querySelector('.studio')!.addEventListener('click', async () => {
    const link = await buildPermalink(layoutForReading(shown?.patch ?? example.patch), STUDIO);
    window.open(link.url, '_blank', 'noopener');
  });
  unsubscribe?.();
  unsubscribe = onChange(syncButton);
}

let unsubscribe: (() => void) | null = null;

// ---------- expanded: the patch beside its code ----------

let expanded: { el: HTMLElement; pane: PatchPane; off: () => void } | null = null;

function closeExpanded(): void {
  if (!expanded) return;
  expanded.off();
  expanded.pane.destroy();
  expanded.el.remove();
  expanded = null;
}

function openExpanded(entry: Entry, key: string, code: () => string, patch: () => unknown): void {
  closeExpanded();
  const el = document.createElement('div');
  el.className = 'expanded';
  el.style.setProperty('--c', entry.color);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${entry.name}: patch and code`);
  el.innerHTML = `
    <header><h2>${esc(entry.name)}</h2>
      <button class="play" title="Play / stop">${playing() === key ? '■' : '▶'}</button>
      <button class="close" title="Close (Esc)">✖</button></header>
    <div class="cols"><div class="big-patch"></div><pre class="code-view"></pre></div>`;
  document.body.appendChild(el);
  (el.querySelector('.code-view') as HTMLElement).textContent = code();
  const bigPane = new PatchPane(el.querySelector('.big-patch') as HTMLElement, {
    widgetFor: (id) => (playing() === key ? builtWidget(id) : undefined),
  });
  bigPane.show(patch());
  const playBtn = el.querySelector('.play') as HTMLButtonElement;
  playBtn.addEventListener('click', () => (panel.querySelector('.play') as HTMLButtonElement | null)?.click());
  const offChange = onChange(() => { playBtn.textContent = playing() === key ? '■' : '▶'; bigPane.refreshWidgets(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeExpanded(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.close')!.addEventListener('click', closeExpanded);
  expanded = { el, pane: bigPane, off: () => { offChange(); document.removeEventListener('keydown', onKey); } };
}

// For tests (as web/ exposes window.__patcher): set the editor's text without typing.
(window as unknown as { __reference: object }).__reference = {
  setCode(text: string) { editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } }); },
  code: () => editor?.state.doc.toString() ?? null,
  playing,
};
onStatus((message) => {
  const s = panel.querySelector('.status');
  if (s && !s.classList.contains('error')) s.textContent = message;
});

function onRoute(): void {
  const m = location.hash.match(/^#objects\/([^/]+)(?:\/(\d+))?/);
  if (!m) {
    void stop();
    editor?.destroy(); editor = null;
    stopScope?.(); stopScope = null;
    pane?.destroy(); pane = null;
    closeExpanded();
    panel.hidden = true;
    document.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
    return;
  }
  const name = decodeURIComponent(m[1]);
  if (shown && playing() && !playing()!.startsWith(name + '/')) void stop();
  showPanel(name, Number(m[2] ?? 0));
}

renderList();
window.addEventListener('hashchange', onRoute);
onRoute();
