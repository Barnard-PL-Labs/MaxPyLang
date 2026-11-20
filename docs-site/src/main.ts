// The MaxPyLang object reference: a Hydra-style page where each Max object has a
// maxpylang example you can play, edit and run in the browser.
//
// Route: #objects/<name>/<example>, e.g. #objects/cycle~/1 (Hydra: #functions/noise/0).

import './style.css';
import { play, stop, playing, onChange, builtWidget, engineForTests, setVolume, getVolume } from './player';
import { categories, findEntry, silentReason, pyArg, type Entry, type Example } from './entries';
import { compile, lastLine, LoadError, onStatus, pythonLoaded } from './compiler';
import { takeWarnings, wrapForChecks } from './checks';
import { mountEditor } from './editor';
import { mountScope } from './scope';
import { PatchPane, layoutForReading } from './patchview';
import { buildPermalink } from '../../web/src/ui/permalink';
import notesFile from '../content/notes.json';

const notes = notesFile as { noExample: Record<string, string>; note: Record<string, string> };
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
      <a href="${BASE}app/interactive-plugin.html" title="Build a Max for Live effect in the browser">Plugin generator</a>
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

// The reader's edits, per example, kept while they browse (and across a reload of this tab):
// the code, and the patch and warnings from the last time that code ran.
interface Edit { code: string; ran?: { code: string; patch: unknown; warnings: string[] } }
const EDITS_KEY = 'reference-edits';
const edits = new Map<string, Edit>();
try {
  for (const [k, v] of Object.entries(JSON.parse(sessionStorage.getItem(EDITS_KEY) ?? '{}') as Record<string, string>)) edits.set(k, { code: v });
} catch { /* storage blocked: edits last until the page closes */ }
function saveEdits(): void {
  try { sessionStorage.setItem(EDITS_KEY, JSON.stringify(Object.fromEntries([...edits].map(([k, e]) => [k, e.code])))); } catch { /* ignore */ }
}

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
  if (notes.note[e.name]) lines.push(`<p class="warn">${esc(notes.note[e.name])}</p>`);
  if (e.sameAs) lines.push(`<p class="hint"><code>${esc(e.name)}</code> and <code>${esc(e.sameAs)}</code> are two names for the same object, so they share examples.</p>`);
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
  const kept = edits.get(key);
  const keptRun = kept?.ran && kept.ran.code === kept.code ? kept.ran : undefined;
  shown = { entry, example, key, code: kept?.code ?? example?.code ?? '', patch: keptRun?.patch ?? example?.patch ?? null };

  editor?.destroy(); editor = null;
  stopScope?.(); stopScope = null;
  pane?.destroy(); pane = null;
  document.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
  document.querySelectorAll(`.chip[href="${CSS.escape(route(entry.name))}"]`).forEach((c) => c.classList.add('active'));

  const tabs = entry.examples.map((x) => {
    const edited = edits.has(`${entry.name}/${x.index}`);
    return `<a class="tab${x === example ? ' on' : ''}${edited ? ' edited' : ''}" href="${route(entry.name, x.index)}" title="${esc(x.title)}${edited ? ' (edited)' : ''}">${x.index}</a>`;
  }).join('');

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
      <p class="patch-note">The patch this code makes, arranged top to bottom for reading. While it plays, its sliders, dials and keys are live: drag them to change the sound. Drag the background to move around; ⌘/Ctrl + scroll to zoom.</p>
      <div class="bar">
        <div class="tabs">${tabs}</div>
        <label class="volume" title="Volume"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><input type="range" min="0" max="1" step="0.01" aria-label="Volume" /></label>
        <div class="buttons">
          <button class="play" title="Play / stop (Ctrl+Enter or ⌘+Enter)">▶</button>
          <button class="reset" title="Undo your edits">↺</button>
          <button class="copy" title="Copy the code">⧉</button>
          <button class="studio" title="Open this patch in MaxPyStudio">↗</button>
        </div>
      </div>
      <p class="ex-title"><b>${esc(example.title)}</b> ${esc(example.note)}</p>
      ${silentReason(entry.name, example.patch) ? `<p class="warn graph-only">${esc(silentReason(entry.name, example.patch)!)}</p>` : ''}
      <div class="editor"></div>
      <p class="status">${silentReason(entry.name, example.patch) ? 'Edit the code and press ▶ or Ctrl+Enter (⌘+Enter) to build it and run maxpylang\'s checks.' : 'Edit the code and press ▶ or Ctrl+Enter (⌘+Enter) to run it.'}</p>
      <ul class="warnings" hidden></ul>`
    : `<p class="none">${esc(notes.noExample[entry.name] ?? 'No example for this object yet.')}</p>`}
    ${entry.description ? `<h3>About</h3><p class="desc">${esc(entry.description)}</p>` : ''}
    ${portsHtml(entry)}`;

  panel.querySelector('.close')!.addEventListener('click', (ev) => { ev.preventDefault(); location.hash = ''; });
  if (!example) return;

  const status = panel.querySelector('.status') as HTMLElement;
  const setStatus = (text: string, kind = '') => { status.textContent = text; status.className = 'status ' + kind; };
  const warnList = panel.querySelector('.warnings') as HTMLUListElement;
  const showWarnings = (found: string[]) => {
    warnList.hidden = found.length === 0;
    warnList.innerHTML = found.map((w) => {
      const [kind, ...rest] = w.split(': ');
      return `<li><b>${esc(kind)}</b> ${esc(rest.join(': '))}</li>`;
    }).join('');
  };
  const markTab = () => {
    const tab = panel.querySelector(`.tab[href="${CSS.escape(route(entry.name, example.index))}"]`);
    tab?.classList.toggle('edited', edits.has(key));
  };
  // Box ids (obj-1, obj-2…) repeat across patches, so mount the engine's live widgets
  // only while this example is the one playing.
  pane = new PatchPane(panel.querySelector('.patch-host') as HTMLElement, {
    fitHeight: { min: 120, max: 340 },
    widgetFor: (id) => (playing() === key ? builtWidget(id) : undefined),
    onExpand: () => openExpanded(entry, key, () => shown?.code ?? example.code, () => shown?.patch ?? example.patch),
  });
  const drawPatch = (p: unknown) => {
    pane?.show(p);
    if (expanded?.key === key) expanded.showPatch(p);
  };
  drawPatch(shown.patch);
  if (kept) {
    setStatus(keptRun ? 'Your edited code, as you left it. ↺ goes back to the original.'
      : 'Your edited code, as you left it (not run yet). ↺ goes back to the original.');
    showWarnings(keptRun?.warnings ?? []);
  }

  editor = mountEditor(panel.querySelector('.editor') as HTMLElement, shown.code, {
    onRun: () => void runOrStop(true),
    onChange: (text) => {
      if (!shown) return;
      shown.code = text;
      if (text === example.code) edits.delete(key);
      else edits.set(key, { ...edits.get(key), code: text });
      saveEdits();
      markTab();
      if (expanded?.key === key) expanded.showCode(text);
    },
  });
  stopScope = mountScope(panel.querySelector('.scope') as HTMLCanvasElement, () => entry.color, () => playing() === key);

  const vol = panel.querySelector('.volume input') as HTMLInputElement;
  vol.value = String(getVolume());
  vol.addEventListener('input', () => {
    setVolume(Number(vol.value));
    try { localStorage.setItem('reference-volume', vol.value); } catch { /* private mode: just don't remember */ }
  });

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
      let found: string[] = [];
      if (edited) {
        const code = shown.code;
        const last = edits.get(key)?.ran;
        if (last && last.code === code) {
          ({ patch, warnings: found } = last); // ran this exact code before: no need to compile again
        } else {
          setStatus(pythonLoaded() ? 'Running your code…' : 'Loading Python in the browser (a few seconds, first time only)…');
          patch = await compile(wrapForChecks(code));
          found = takeWarnings(patch);
          const e = edits.get(key);
          if (e) e.ran = { code, patch, warnings: found };
        }
        drawPatch(patch);
      }
      showWarnings(found);
      shown.patch = patch;
      const silent = silentReason(entry!.name, patch);
      if (silent) {
        // Graph-only: the patch is real maxpylang output, but the browser can't run part of it.
        if (playing()) await stop();
        setStatus(`Built${edited ? ' your edited code' : ''}: the patch is drawn above. ${edited ? silent : 'It plays in Max, not here.'}`
          + (edited ? (found.length ? ` maxpylang's checks found ${found.length === 1 ? 'a problem' : `${found.length} problems`}:` : " maxpylang's checks found no problems.") : ''),
          found.length ? 'warn-status' : '');
        return;
      }
      await play(key, patch);
      setStatus(!edited ? 'Playing. Edit the code and press ▶ or Ctrl+Enter (⌘+Enter) to run it.'
        : found.length ? `Playing your edited code. maxpylang's checks found ${found.length === 1 ? 'a problem' : `${found.length} problems`}:`
        : "Playing your edited code. maxpylang's checks found no problems.", found.length ? 'warn-status' : 'ok');
    } catch (err) {
      showWarnings([]);
      if (err instanceof LoadError) console.warn('Python failed to start:', err.detail);
      setStatus(err instanceof LoadError ? err.message : lastLine(String((err as Error).message ?? err)), 'error');
    }
  }

  playBtn.addEventListener('click', () => void runOrStop());
  panel.querySelector('.reset')!.addEventListener('click', () => {
    editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: example.code } });
    edits.delete(key);
    saveEdits();
    markTab();
    if (shown) shown.patch = example.patch;
    drawPatch(example.patch);
    showWarnings([]);
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

let expanded: {
  el: HTMLElement; pane: PatchPane; key: string; off: () => void;
  showPatch(p: unknown): void; showCode(text: string): void;
} | null = null;

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
  const codeView = el.querySelector('.code-view') as HTMLElement;
  expanded = {
    el, pane: bigPane, key,
    off: () => { offChange(); document.removeEventListener('keydown', onKey); },
    // The panel calls these on every run and every edit, so this view always matches it.
    showPatch: (p) => bigPane.show(p),
    showCode: (text) => { codeView.textContent = text; },
  };
}

// For tests (as web/ exposes window.__patcher): set the editor's text without typing.
(window as unknown as { __reference: object }).__reference = {
  setCode(text: string) { editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } }); },
  code: () => editor?.state.doc.toString() ?? null,
  playing,
  engine: engineForTests,
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

try {
  const saved = localStorage.getItem('reference-volume');
  if (saved !== null && Number.isFinite(Number(saved))) setVolume(Number(saved));
} catch { /* storage blocked: start at full volume */ }

renderList();
window.addEventListener('hashchange', onRoute);
onRoute();
