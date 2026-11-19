// The plugin generator page.
//
// One loop runs the whole thing:
//
//   settings ──▶ fxgen.py (maxpylang, in Pyodide) ──▶ patcher JSON ──┬─▶ engine (sound)
//       ▲                                                           ├─▶ device view
//       │                                                           └─▶ .amxd download
//       └──────────── a dial turned in the device view ◀────────────────┘
//
// The left panel edits STRUCTURE (which modules, in what order, their modes) and every
// such edit regenerates the patch. The dials in the device view edit VALUES; they act on
// the running patch directly, and are written back into the settings so the next build,
// the shared link and the downloaded file all carry them.

import '../objects'; // side effect: registers every object the engine can play
import './plugin.css';
import { Engine } from '../engine/engine';
import type { MaxNode } from '../engine/registry';
import { parseMaxPat } from '../parser/maxpat';
import { preloadWorklets } from '../runtime/worklet';
import { firstNum } from '../runtime/atoms';
import { Track, type SampleDef } from './audio';
import { DEVICE_HEIGHT, highlightPython, renderDevice, renderPatch } from './device-view';
import {
  PRESETS, SCHEMA, decodeSettings, dialIndex, encodeSettings, moduleSpec, normalize,
  type ChainEntry, type Preset, type Settings,
} from './model';
import { PyRuntime, base64ToBytes, type RunResult } from './python';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const SAMPLES: SampleDef[] = ['piano', 'guitar', 'vocals', 'drums'].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  url: `${import.meta.env.BASE_URL}samples/fx/${id}.mp3`,
}));

/** One line per workaround the generated script carries; the page links each to the log. */
const GAPS: Record<string, string> = {
  'M4L-01': 'A dial’s range, unit and start value cannot be set through edit()',
  'M4L-02': 'Presentation mode has no API, and edit() rejects it on some objects',
  'M4L-03': 'A comment’s text is saved with the object name in front of it',
  'M4L-04': 'Patcher settings (open in presentation, device width) have no API',
};
const GAP_LOG = 'https://github.com/Barnard-PL-Labs/MaxPyLang/blob/main/docs/type-system/m4l-gaps.md';

// ── state ───────────────────────────────────────────────────────────────────────

let activePreset: string | undefined;
let result: RunResult | undefined;
let buildSeq = 0;
let view: 'device' | 'patch' = 'device';
let sampleId = 'piano';
let customBuffer: AudioBuffer | undefined;
let dialOffs: (() => void)[] = [];
let deviceWidth = 0;
// Last, because choosing the starting device also sets the preset and sample above.
let settings: Settings = initialSettings();

const engine = new Engine();
const track = new Track(engine.ctx as AudioContext);
const worklets = preloadWorklets(engine.ctx);
const dials = dialIndex();
const python = new PyRuntime((message) => setStatus('loading', capitalize(message.replace(/…$/, ''))));

function initialSettings(): Settings {
  const fragment = location.hash.match(/^#s=(.+)$/)?.[1];
  const shared = fragment ? decodeSettings(fragment) : undefined;
  if (shared) return shared;
  const first = PRESETS[0];
  activePreset = first.id;
  if (first.sample) sampleId = first.sample;
  return normalize(first.settings);
}

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── status, toast ───────────────────────────────────────────────────────────────

function setStatus(state: 'loading' | 'building' | 'ready' | 'error', text: string): void {
  $('status').dataset.state = state;
  $('status-text').textContent = text;
  if (state === 'loading') $('boot-text').textContent = text;
}

let toastTimer = 0;
function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

// ── building ────────────────────────────────────────────────────────────────────

let buildTimer = 0;
/** Regenerate the device. `delay` coalesces bursts (typing a name, dragging a module). */
function scheduleBuild(delay = 0): void {
  clearTimeout(buildTimer);
  clearTimeout(scriptTimer);
  buildTimer = window.setTimeout(() => void build(), delay);
  syncHash();
}

async function build(): Promise<void> {
  const seq = ++buildSeq;
  try {
    await python.ready;
    if (seq !== buildSeq) return;
    setStatus('building', 'Building');
    const next = await python.run(settings, false);
    if (seq !== buildSeq) return; // a newer edit is already on its way
    await worklets;
    await apply(next);
    setStatus('ready', 'Python ready');
  } catch (err) {
    if (seq !== buildSeq) return;
    console.error(err);
    setStatus('error', 'Build failed');
    showCheckError(String((err as Error).message || err));
  }
}

async function apply(next: RunResult): Promise<void> {
  result = next;
  const patch = parseMaxPat(next.json);
  for (const off of dialOffs) off();
  dialOffs = [];

  const report = await track.duck(() => engine.build(patch));

  // Listen to each dial, so a knob turned here becomes the value that gets saved.
  for (const node of patch.nodes) {
    if (node.maxclass !== 'live.dial') continue;
    const target = dials.get(String(node.raw?.varname ?? ''));
    const live = report.built.get(node.id);
    if (!target || !live?.onControlOut) continue;
    const off = live.onControlOut(0, (m) => {
      const v = firstNum(m);
      if (v !== undefined) dialMoved(target.module, target.param, v);
    });
    if (typeof off === 'function') dialOffs.push(off);
  }

  deviceWidth = renderDevice($('device'), next.json, report.built as ReadonlyMap<string, MaxNode>);
  const hidden = renderPatch($('patch-wrap'), patch);
  $('patch-wrap').dataset.hidden = String(hidden);
  fitDevice();

  $('boot').hidden = true;
  $<HTMLButtonElement>('btn-download').disabled = false;
  renderCheck(next);
  renderCode(next);
  renderHead();
}

let scriptTimer = 0;
function dialMoved(module: string, param: string, value: number): void {
  const store = module === SCHEMA.output.id ? settings.output : settings.chain.find((e) => e.module === module)?.values;
  if (!store || Math.abs((store[param] ?? NaN) - value) < 1e-9) return;
  store[param] = value;
  markCustom();
  syncHash();
  // The sound already changed. Only the script and the check panel are stale, so refresh
  // those once the knob has come to rest, without touching the running patch.
  clearTimeout(scriptTimer);
  scriptTimer = window.setTimeout(() => void refreshScript(), 450);
}

async function refreshScript(): Promise<void> {
  const seq = buildSeq;
  try {
    const next = await python.run(settings, false);
    if (seq !== buildSeq) return;
    result = next;
    renderCode(next);
  } catch (err) {
    console.error(err);
  }
}

let hashTimer = 0;
function syncHash(): void {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    history.replaceState(null, '', `#s=${encodeSettings(settings)}`);
  }, 300);
}

// ── head, check panel, code ─────────────────────────────────────────────────────

function renderHead(): void {
  $('device-title').textContent = settings.name;
  const on = settings.chain.filter((e) => e.on).map((e) => moduleSpec(e.module)?.label ?? e.module);
  const flow = $('device-flow');
  flow.replaceChildren();
  for (const [i, part] of ['plugin~', ...on, 'Output', 'plugout~'].entries()) {
    if (i) flow.append(Object.assign(document.createElement('i'), { textContent: '→' }));
    flow.append(Object.assign(document.createElement('span'), { textContent: part, className: part.endsWith('~') ? 'io' : '' }));
  }
}

function stat(value: string | number, label: string, tone = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `stat ${tone}`;
  el.append(
    Object.assign(document.createElement('b'), { textContent: String(value) }),
    Object.assign(document.createElement('span'), { textContent: label }),
  );
  return el;
}

function renderCheck(r: RunResult): void {
  const host = $('check');
  host.replaceChildren();
  const cords = r.coverage.cords;
  const objects = r.coverage.objects;
  const stats = document.createElement('div');
  stats.className = 'stats';
  if (cords && objects) {
    stats.append(
      stat(objects.total, 'objects'),
      stat(cords.total, 'cords'),
      stat(cords.checked, 'cords checked', cords.checked === cords.total ? 'good' : ''),
      stat(cords.flagged, 'flagged', cords.flagged ? 'bad' : 'good'),
      stat(cords.not_checked, 'not checked', cords.not_checked ? 'warn' : 'good'),
    );
  }
  host.append(stats);

  const lines: string[] = [];
  for (const w of r.warnings) lines.push(`${w.category}: ${w.message}`);
  // A reason arrives as [object, why, how many cords]. The same object class usually
  // appears once per channel, so the lines are merged by class.
  const unjudged = new Map<string, number>();
  for (const reason of cords?.not_checked_because ?? []) {
    const [what, why, count] = Array.isArray(reason) ? reason : [String(reason), '', 1];
    const key = `${String(what).replace(/ \(obj-\d+\)$/, '')}: ${String(why)}`;
    unjudged.set(key, (unjudged.get(key) ?? 0) + (Number(count) || 1));
  }
  for (const [key, count] of unjudged) lines.push(`not checked, ${count} cord${count === 1 ? '' : 's'} from ${key}`);
  for (const name of objects?.not_seen_into ?? []) lines.push(`cannot see into: ${name}`);
  if (lines.length) {
    const ul = document.createElement('ul');
    ul.className = 'check-lines';
    for (const line of lines) ul.append(Object.assign(document.createElement('li'), { textContent: line }));
    host.append(ul);
  }

  // What the checks did NOT judge because maxpylang cannot express it yet: every
  // workaround in the script names its gap, so the list is read off the script itself.
  const ids = [...new Set([...r.script.matchAll(/gap (M4L-\d+)/g)].map((m) => m[1]))].sort();
  if (ids.length) {
    const gaps = document.createElement('details');
    gaps.className = 'gaps';
    const head = document.createElement('summary');
    head.innerHTML = `<b>${ids.length} things this device needs that MaxPyLang cannot say yet.</b> The script works around each one, and each is in the <a href="${GAP_LOG}" target="_blank" rel="noopener">gap log</a>.`;
    const ul = document.createElement('ul');
    for (const id of ids) {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('code'), { textContent: id }), ` ${GAPS[id] ?? ''}`);
      ul.append(li);
    }
    gaps.append(head, ul);
    host.append(gaps);
  }
}

function showCheckError(message: string): void {
  const host = $('check');
  host.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'check-error';
  pre.textContent = message;
  host.append(Object.assign(document.createElement('p'), { textContent: 'Python raised an error while building this device:', className: 'bad' }), pre);
}

function renderCode(r: RunResult): void {
  $('code').innerHTML = highlightPython(r.script);
  const lines = r.script.split('\n').length;
  $('py-meta').textContent = `${lines} lines · writes ${r.filename}`;
}

// ── device stage ────────────────────────────────────────────────────────────────

function fitDevice(): void {
  if (!deviceWidth) return;
  const wrap = $('device-wrap');
  const room = wrap.clientWidth - 48;
  const zoom = Math.max(0.62, Math.min(2, room / deviceWidth));
  const device = $('device');
  device.style.transform = `scale(${zoom})`;
  // A transform does not change layout size, so the wrapper is sized by hand.
  const frame = device.parentElement as HTMLElement;
  frame.style.setProperty('--dw', `${deviceWidth * zoom}px`);
  frame.style.setProperty('--dh', `${DEVICE_HEIGHT * zoom}px`);
}

function setView(next: 'device' | 'patch'): void {
  view = next;
  $('stage').dataset.view = next;
  $('view-device').setAttribute('aria-selected', String(next === 'device'));
  $('view-patch').setAttribute('aria-selected', String(next === 'patch'));
  $('device-wrap').hidden = next !== 'device';
  $('patch-wrap').hidden = next !== 'patch';
  if (next === 'device') fitDevice();
}

// ── left panel ──────────────────────────────────────────────────────────────────

function markCustom(): void {
  if (!activePreset) return;
  activePreset = undefined;
  for (const el of document.querySelectorAll('.preset.is-active')) el.classList.remove('is-active');
}

/** The preset sections, in file order: one per effect, as the left panel lists them. */
const SECTIONS = [...new Set(PRESETS.map((p) => p.group))];
let section = 'All';

function renderSections(): void {
  const host = $('sections');
  host.replaceChildren();
  // 'Start' holds only the empty device; it is listed under All and needs no chip.
  for (const name of ['All', ...SECTIONS.filter((g) => g !== 'Start')]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'section-chip';
    b.textContent = name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(name === section));
    b.addEventListener('click', () => {
      section = name;
      renderSections();
      renderPresets();
      $('presets').scrollIntoView({ block: 'nearest' });
    });
    host.append(b);
  }
}

function renderPresets(): void {
  const host = $('presets');
  host.replaceChildren();
  for (const group of SECTIONS) {
    if (section !== 'All' && section !== group) continue;
    const list = PRESETS.filter((p) => p.group === group);
    const head = document.createElement('h3');
    head.append(group, Object.assign(document.createElement('small'), { textContent: String(list.length) }));
    host.append(head);
    const rows = document.createElement('div');
    rows.className = 'preset-list';
    for (const p of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `preset${p.id === activePreset ? ' is-active' : ''}`;
      b.style.setProperty('--dot', p.settings.accent ?? SCHEMA.accents[0]);
      b.title = p.tag;
      b.append(
        Object.assign(document.createElement('b'), { textContent: p.name }),
        Object.assign(document.createElement('span'), { textContent: p.tag }),
      );
      b.addEventListener('click', () => loadPreset(p));
      rows.append(b);
    }
    host.append(rows);
  }
}

function loadPreset(p: Preset): void {
  settings = normalize(p.settings);
  activePreset = p.id;
  if (p.sample && !customBuffer) void chooseSample(p.sample);
  renderSide();
  scheduleBuild();
}

function renderAccents(): void {
  const host = $('accents');
  host.replaceChildren();
  for (const colour of SCHEMA.accents) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'accent';
    b.style.background = colour;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(colour === settings.accent));
    b.setAttribute('aria-label', colour);
    b.addEventListener('click', () => {
      settings.accent = colour;
      markCustom();
      applyAccent();
      renderAccents();
      scheduleBuild();
    });
    host.append(b);
  }
}

function applyAccent(): void {
  document.documentElement.style.setProperty('--accent', settings.accent);
}

let dragId: string | undefined;

function renderChain(): void {
  const host = $('chain');
  host.replaceChildren();
  settings.chain.forEach((entry, index) => host.append(chainItem(entry, index)));
}

function chainItem(entry: ChainEntry, index: number): HTMLElement {
  const mod = moduleSpec(entry.module)!;
  const li = document.createElement('li');
  li.className = `mod${entry.on ? ' is-on' : ''}`;
  li.dataset.id = entry.module;
  li.draggable = true;

  const row = document.createElement('div');
  row.className = 'mod-row';

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.title = 'Drag to reorder';
  grip.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/><circle cx="3" cy="12" r="1.1"/><circle cx="7" cy="12" r="1.1"/></g></svg>';

  const name = document.createElement('div');
  name.className = 'mod-name';
  name.append(
    Object.assign(document.createElement('b'), { textContent: mod.label }),
    Object.assign(document.createElement('span'), { textContent: mod.params.map((p) => p.label).join(' · ') }),
  );

  const move = document.createElement('div');
  move.className = 'mod-move';
  for (const [dir, glyph, text] of [[-1, 'M3 9l4-4 4 4', 'Move up'], [1, 'M3 5l4 4 4-4', 'Move down']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${text}: ${mod.label}`;
    b.setAttribute('aria-label', `${text}: ${mod.label}`);
    b.disabled = index + dir < 0 || index + dir >= settings.chain.length;
    b.innerHTML = `<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="${glyph}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    b.addEventListener('click', () => moveModule(entry.module, index + dir));
    move.append(b);
  }

  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'switch';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(entry.on));
  sw.setAttribute('aria-label', `${mod.label} on`);
  sw.addEventListener('click', () => {
    entry.on = !entry.on;
    markCustom();
    renderChain();
    scheduleBuild();
  });

  row.append(grip, name, move, sw);
  li.append(row);

  if (entry.on) {
    const body = document.createElement('div');
    body.className = 'mod-body';
    if (mod.blurb) body.append(Object.assign(document.createElement('p'), { textContent: mod.blurb }));
    for (const opt of mod.options) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', `${mod.label} ${opt.label}`);
      for (const choice of opt.choices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = choice.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(entry.options[opt.id] === choice.id));
        b.addEventListener('click', () => {
          if (entry.options[opt.id] === choice.id) return;
          entry.options[opt.id] = choice.id;
          markCustom();
          renderChain();
          scheduleBuild();
        });
        seg.append(b);
      }
      body.append(seg);
    }
    li.append(body);
  }

  li.addEventListener('dragstart', (e) => {
    dragId = entry.module;
    li.classList.add('is-dragging');
    e.dataTransfer?.setData('text/plain', entry.module);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  li.addEventListener('dragend', () => {
    dragId = undefined;
    for (const el of document.querySelectorAll('.mod')) el.classList.remove('is-dragging', 'drop-before', 'drop-after');
  });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === entry.module) return;
    e.preventDefault();
    const box = li.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    li.classList.toggle('drop-before', !after);
    li.classList.toggle('drop-after', after);
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
  li.addEventListener('drop', (e) => {
    if (!dragId || dragId === entry.module) return;
    e.preventDefault();
    const after = li.classList.contains('drop-after');
    const from = settings.chain.findIndex((c) => c.module === dragId);
    let to = settings.chain.findIndex((c) => c.module === entry.module) + (after ? 1 : 0);
    if (from < to) to--;
    moveModule(dragId, to);
  });
  return li;
}

function moveModule(id: string, to: number): void {
  const from = settings.chain.findIndex((c) => c.module === id);
  if (from < 0 || to < 0 || to >= settings.chain.length || from === to) return;
  const [entry] = settings.chain.splice(from, 1);
  settings.chain.splice(to, 0, entry);
  markCustom();
  renderChain();
  // Order only matters to the sound between modules that are switched on, but the
  // script lists them in this order either way, so rebuild regardless.
  scheduleBuild();
}

function setTab(tab: 'presets' | 'build'): void {
  for (const id of ['presets', 'build'] as const) {
    $(`tab-${id}`).setAttribute('aria-selected', String(id === tab));
    $(`pane-${id}`).hidden = id !== tab;
  }
}

function renderSide(): void {
  renderSections();
  renderPresets();
  $<HTMLInputElement>('name').value = settings.name;
  applyAccent();
  renderAccents();
  renderChain();
  renderHead();
}

// ── transport ───────────────────────────────────────────────────────────────────

function renderSamples(): void {
  const host = $('samples');
  host.replaceChildren();
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(!customBuffer && s.id === sampleId));
    b.addEventListener('click', () => {
      customBuffer = undefined;
      $('file-name').textContent = 'Your audio';
      void chooseSample(s.id);
    });
    host.append(b);
  }
  document.querySelector('.chip.upload')?.classList.toggle('is-active', !!customBuffer);
}

async function chooseSample(id: string): Promise<void> {
  sampleId = id;
  renderSamples();
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return;
  try {
    const buffer = await track.load(sample);
    if (sampleId === id && !customBuffer) track.setBuffer(buffer);
  } catch (err) {
    toast(String((err as Error).message || err));
  }
}

async function useFile(file: File): Promise<void> {
  try {
    const buffer = await track.decode(await file.arrayBuffer());
    customBuffer = buffer;
    $('file-name').textContent = file.name.length > 22 ? `${file.name.slice(0, 20)}…` : file.name;
    renderSamples();
    track.setBuffer(buffer);
    if (!track.playing) await setPlaying(true);
  } catch {
    toast('That file could not be decoded as audio.');
  }
}

async function setPlaying(on: boolean): Promise<void> {
  const btn = $('btn-play');
  if (on) {
    await engine.start();
    track.play();
    startScope();
  } else {
    track.stop();
    await engine.stop();
  }
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Stop' : 'Play');
  document.body.classList.toggle('is-playing', on);
}

// ── scope + meter ───────────────────────────────────────────────────────────────

let scopeRunning = false;
function startScope(): void {
  if (scopeRunning) return;
  scopeRunning = true;
  const canvas = $<HTMLCanvasElement>('scope');
  const g = canvas.getContext('2d')!;
  const bins = new Uint8Array(new ArrayBuffer(track.analyser.frequencyBinCount));
  const meterL = $('meter-l');
  const meterR = $('meter-r');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let peaks: [number, number] = [0, 0];

  const frame = (): void => {
    if (!track.playing) {
      scopeRunning = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      meterL.style.setProperty('--level', '0');
      meterR.style.setProperty('--level', '0');
      return;
    }
    requestAnimationFrame(frame);

    const [l, r] = track.levels();
    peaks = [Math.max(l, peaks[0] * 0.9), Math.max(r, peaks[1] * 0.9)];
    const toBar = (p: number): string => String(Math.max(0, Math.min(1, 1 + (20 * Math.log10(p || 1e-6)) / 48)));
    meterL.style.setProperty('--level', toBar(peaks[0]));
    meterR.style.setProperty('--level', toBar(peaks[1]));
    meterL.classList.toggle('clip', l >= 0.999);
    meterR.classList.toggle('clip', r >= 0.999);

    if (reduce || view !== 'device') {
      g.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    track.analyser.getByteFrequencyData(bins);

    // A log-frequency spectrum from 40 Hz to 16 kHz, filled up from the stage floor.
    const nyquist = engine.ctx.sampleRate / 2;
    const lo = Math.log(40);
    const hi = Math.log(16000);
    const steps = 96;
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i <= steps; i++) {
      const f = Math.exp(lo + ((hi - lo) * i) / steps);
      const bin = Math.min(bins.length - 1, Math.round((f / nyquist) * bins.length));
      const y = h - (bins[bin] / 255) ** 1.5 * h * 0.92;
      g.lineTo((i / steps) * w, y);
    }
    g.lineTo(w, h);
    g.closePath();
    const fill = g.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, `${settings.accent}88`);
    fill.addColorStop(1, `${settings.accent}00`);
    g.fillStyle = fill;
    g.fill();
  };
  requestAnimationFrame(frame);
}

// ── downloads, drawer, sharing ──────────────────────────────────────────────────

function save(bytes: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function download(): Promise<void> {
  const btn = $<HTMLButtonElement>('btn-download');
  btn.disabled = true;
  btn.classList.add('is-busy');
  try {
    // Built fresh, from the settings as they are this instant, so every dial is saved
    // where it currently stands.
    const out = await python.run(settings, true);
    if (!out.amxd) throw new Error('the generator returned no device');
    save(base64ToBytes(out.amxd), out.filename, 'application/octet-stream');
    result = out;
    renderCode(out);
    toast(`Saved ${out.filename}. Drag it onto an audio track in Live.`);
  } catch (err) {
    console.error(err);
    toast('The download failed. See the type check panel.');
    showCheckError(String((err as Error).message || err));
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }
}

function setDrawer(open: boolean): void {
  $('drawer').classList.toggle('open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  $('btn-python').setAttribute('aria-expanded', String(open));
  $('scrim').hidden = !open;
  if (open) $('drawer-close').focus();
  else $('btn-python').focus();
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copying was blocked by the browser.');
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────────

function init(): void {
  renderSide();
  renderSamples();
  setView('device');

  $('name').addEventListener('input', () => {
    const typed = $<HTMLInputElement>('name').value;
    settings.name = normalize({ name: typed }).name;
    markCustom();
    renderHead();
    scheduleBuild(450);
  });
  $('name').addEventListener('blur', () => { $<HTMLInputElement>('name').value = settings.name; });

  $('tab-presets').addEventListener('click', () => setTab('presets'));
  $('tab-build').addEventListener('click', () => setTab('build'));
  $('view-device').addEventListener('click', () => setView('device'));
  $('view-patch').addEventListener('click', () => setView('patch'));

  $('btn-play').addEventListener('click', () => void setPlaying(!track.playing));
  $('btn-bypass').addEventListener('click', () => {
    track.bypass = !track.bypass;
    $('btn-bypass').setAttribute('aria-pressed', String(track.bypass));
    $('stage').classList.toggle('is-bypassed', track.bypass);
  });
  $('file').addEventListener('change', () => {
    const file = $<HTMLInputElement>('file').files?.[0];
    if (file) void useFile(file);
    $<HTMLInputElement>('file').value = '';
  });

  // Drop an audio file anywhere on the page to play it through the device.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    void useFile(file);
  });

  $('btn-download').addEventListener('click', () => void download());
  $('btn-python').addEventListener('click', () => setDrawer(!$('drawer').classList.contains('open')));
  $('drawer-close').addEventListener('click', () => setDrawer(false));
  $('scrim').addEventListener('click', () => setDrawer(false));
  $('btn-copy').addEventListener('click', () => { if (result) void copy(result.script, 'Script copied.'); });
  $('btn-py').addEventListener('click', () => {
    if (result) save(result.script, result.filename.replace(/\.amxd$/, '.py'), 'text/x-python');
  });
  $('btn-share').addEventListener('click', () => {
    history.replaceState(null, '', `#s=${encodeSettings(settings)}`);
    void copy(location.href, 'Link copied. It opens this exact device.');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('drawer').classList.contains('open')) setDrawer(false);
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    const onControl = target.tagName === 'BUTTON' || target.getAttribute('role') === 'slider';
    if (e.code === 'Space' && !typing && !onControl) {
      e.preventDefault();
      void setPlaying(!track.playing);
    }
  });

  new ResizeObserver(() => fitDevice()).observe($('device-wrap'));

  python.ready.catch((err: Error) => {
    setStatus('error', 'Python failed to start');
    $('boot-text').textContent = 'Python could not start in this browser.';
    showCheckError(String(err.message || err));
  });

  void chooseSample(sampleId);
  scheduleBuild();
}

init();

if (import.meta.env.DEV) {
  const fx = { engine, track, get settings() { return settings; }, get result() { return result; } };
  Object.assign(window, { __fx: fx });
  // The offline renderer used to compare this engine with Max (see offline.ts).
  void import('./offline').then((offline) => Object.assign(fx, offline));
}
