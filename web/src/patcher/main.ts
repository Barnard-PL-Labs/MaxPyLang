// The patcher's app shell: the page's one long-lived object graph, and the wiring point
// every other patcher module plugs into.
//
// It deliberately renders nothing. The canvas is drawn by ui/patcher.ts and driven by
// ui/patcher-input.ts; the palette and inspector are Phase 6. What lives here is the
// state that must outlive all of them and can only have one owner:
//
//   • ONE AudioContext, and ONE Engine on top of it, for the life of the page. Engine
//     .dispose() closes the context, and a closed context throws away the user's
//     audio-unlock gesture — the next ▶ would be silent until they clicked again. So
//     nothing here ever disposes: loading a different patch is clear() + build(), and
//     preloadWorklets() runs once against the context, before the first build, because
//     a worklet module has to be registered before any AudioWorkletNode is constructed.
//
//   • THE DOCUMENT, created through PatchDoc.create()/open() so generated/boxspecs.json
//     is resolved before any box can be typed. (PatchDoc.empty()/fromIR() are the sync
//     escape hatches and would give `unpack 1 2 3` two outlets — see patch-doc.ts.)
//
//   • THE OP SUBSCRIPTION. doc.on() fires once per transaction with the full op list,
//     and that list is the engine's change notification: applyOps maps it onto
//     incremental engine calls, and maps `set-rect` onto nothing at all, which is what
//     lets a box be dragged without touching audio.
//
//   • THE CHROME: mode, transport, zoom, the panes, the drawer and the status line —
//     everything patcher.html declares an id for. Layout state is written as `data-*` on
//     <body> and never as an inline style, so ui/patcher.css owns every responsive
//     decision and the persisted preferences restore in one assignment.
//
// The renderer is attached through a factory rather than constructed inline:
// useRenderer() is called whenever the document is REPLACED (open/new), and the shell
// destroys the previous view — and the gesture controller bound to its <svg> — first.
// The default factory at the bottom of this file builds the real ui/patcher.ts
// `PatcherView`; a test can swap in its own. The dependency runs one way only
// (ui/patcher.ts and ui/patcher-input.ts import nothing from here), so there is no cycle.
//
// The shell speaks the RENDERER'S vocabulary, not its own: the view owns `viewport`
// (`{x, y, zoom}`) and this file derives zoom-in / zoom-out / 100% from it. An earlier
// draft declared a `CanvasView` port with `zoomBy`/`setZoom`/`zoom` and a
// `refreshWidgets(built)`; that was a second, smaller model of the same state, and the
// two drifted apart before either had run once. Four one-line derivations here are
// cheaper than an interface that has to be kept true.

import '../objects'; // side effect: registers every object (real + Tier-A stubs)
import '../ui/patch.css'; // boxes, cords, widgets — shared with the player and the Studio
import '../ui/patcher.css'; // editor chrome — this page only

import type { Op } from '../doc/ops';
import { PatchDoc } from '../doc/patch-doc';
import { Engine, type BuildReport } from '../engine/engine';
import { isSupported, type MaxNode } from '../engine/registry';
import { parseMaxPat } from '../parser/maxpat';
import { EMPTY_PATCHER_HEADER, patchToMaxPat } from '../parser/write-maxpat';
import { preloadWorklets } from '../runtime/worklet';
import { PatcherView } from '../ui/patcher';
import { Interaction, ownsKeyboard } from '../ui/patcher-input';
import { attachPortTips } from '../ui/tooltip';

// ─────────────────────────────────────────────────────────────────────────────
// Public API — two other modules are written against exactly this.
// ─────────────────────────────────────────────────────────────────────────────

/** Edit: gestures build the patch. Run: gestures play it. Independent of the transport. */
export type PatcherMode = 'edit' | 'run';

export type StatusKind = 'info' | 'ok' | 'error';

/**
 * How the shell builds a view. Called once per document, after the engine has built that
 * document, so `built` already holds the widget elements the view has to mount.
 *
 * `built` is passed even though the default factory reads the shell's live map instead:
 * a factory that captures the map it is handed is correct only until the next rebuild,
 * and saying so in the signature is how the next caller finds that out.
 *
 * The shell learns about a zoom the USER caused from a `patcher:zoom` CustomEvent, which
 * ui/patcher-input.ts dispatches from the <svg> and which bubbles to the canvas host —
 * so nothing here polls the viewport and the view owes no callback registration.
 */
export type ViewFactory = (
  host: HTMLElement,
  doc: PatchDoc,
  built: ReadonlyMap<string, MaxNode>
) => PatcherView;

export interface PatcherShell {
  /** The current document. Replaced by newPatch()/loadPatch(), never mutated here. */
  readonly doc: PatchDoc | null;
  /** The page's single Engine. Null only before the first load completes. */
  readonly engine: Engine | null;
  /** #patcher-canvas — carries `patcher mode-edit|mode-run`. The view mounts INSIDE it. */
  readonly canvas: HTMLElement;
  readonly view: PatcherView | null;
  /** The gesture controller bound to the current view's <svg>. Null with no view. */
  readonly input: Interaction | null;
  readonly mode: PatcherMode;
  setMode(mode: PatcherMode): void;
  toggleMode(): void;
  /** Fires after the mode has been applied to the DOM. Returns an unsubscribe thunk. */
  onModeChange(fn: (mode: PatcherMode) => void): () => void;
  /** Attach (or detach, with null) the canvas renderer. Mounts immediately if a doc exists. */
  useRenderer(factory: ViewFactory | null): void;
  newPatch(): Promise<void>;
  loadPatch(json: unknown, name: string): Promise<void>;
  openFile(file: File): Promise<void>;
  save(): void;
  status(message: string, kind?: StatusKind): void;
  togglePalette(): void;
  toggleInspector(): void;
  toggleDrawer(): void;
  /** Resolves when the startup patch has been loaded (or has failed loudly). */
  readonly ready: Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM contract
// ─────────────────────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  // Loud, not lenient: a missing id means patcher.html and this file have drifted, and
  // every failure downstream of that would be a confusing one.
  if (!node) throw new Error(`patcher.html is missing #${id}`);
  return node as T;
}

const canvasEl = el('patcher-canvas');
const statusEl = el('status');
const consoleEl = el('console');
const docMetaEl = el('doc-meta');

const modeEditBtn = el<HTMLButtonElement>('mode-edit');
const modeRunBtn = el<HTMLButtonElement>('mode-run');
const modeGlyph = el('mode-glyph');

const startBtn = el<HTMLButtonElement>('start');
const stopBtn = el<HTMLButtonElement>('stop');

const newBtn = el<HTMLButtonElement>('file-new');
const openBtn = el<HTMLButtonElement>('file-open');
const saveBtn = el<HTMLButtonElement>('file-save');
const shareBtn = el<HTMLButtonElement>('file-share');
const fileInput = el<HTMLInputElement>('file-input');

const zoomInBtn = el<HTMLButtonElement>('zoom-in');
const zoomOutBtn = el<HTMLButtonElement>('zoom-out');
const zoomLevelBtn = el<HTMLButtonElement>('zoom-level');
const zoomFitBtn = el<HTMLButtonElement>('zoom-fit');

const paletteToggle = el<HTMLButtonElement>('palette-toggle');
const inspectorPin = el<HTMLButtonElement>('inspector-pin');
const scrimEl = el('overlay-scrim');

const drawerToggle = el<HTMLButtonElement>('drawer-toggle');
const drawerGrip = el('drawer-grip');

// ─────────────────────────────────────────────────────────────────────────────
// Preferences. Every accessor is guarded: localStorage throws outright in a Safari
// private window and when a quota is hit, and a preference is never worth a dead page.
// ─────────────────────────────────────────────────────────────────────────────

const PREFIX = 'maxpy.patcher.';

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* private mode, or quota — the session still works, it just won't be remembered */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status line + console
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 300;

function log(message: string, kind: StatusKind): void {
  const line = document.createElement('div');
  if (kind !== 'info') line.className = `log-${kind}`;
  line.textContent = message;
  consoleEl.appendChild(line);
  while (consoleEl.childElementCount > MAX_LOG_LINES) consoleEl.firstElementChild?.remove();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/** The status line lives in the drawer HEAD, which is visible even collapsed. */
function status(message: string, kind: StatusKind = 'info'): void {
  statusEl.textContent = message;
  statusEl.className = kind === 'info' ? 'status' : `status ${kind}`;
  log(message, kind);
}

/**
 * The always-live summary, recomputed on every transaction.
 *
 * The playable count is derived from the DOCUMENT (isSupported per class) rather than
 * from a BuildReport, which is why it can be here at all: the report only exists after a
 * full build, so the build message in the status line below still read "0 objects · 0
 * cords · 0 playable" after three boxes had been typed. A count nobody can trust is
 * worse than no count, so the live one lives here and the status line stays what it is —
 * a line of one-shot messages ("Saved x", "Audio running").
 */
function updateDocMeta(): void {
  if (!doc) {
    docMetaEl.textContent = '';
    return;
  }
  let playable = 0;
  for (const node of doc.nodes()) if (isSupported(node.className)) playable++;
  docMetaEl.textContent =
    `${doc.nodeCount} boxes · ${doc.edgeCount} cords · ${playable} playable` +
    ` · rev ${doc.revision}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode
// ─────────────────────────────────────────────────────────────────────────────

let mode: PatcherMode = 'edit';
const modeListeners = new Set<(mode: PatcherMode) => void>();

function setMode(next: PatcherMode): void {
  mode = next;
  const editing = next === 'edit';
  // ONE class on the canvas root. ui/patcher.css hangs pointer-events, port visibility
  // and the border tint off it; nothing else in the app branches on mode.
  canvasEl.classList.toggle('mode-edit', editing);
  canvasEl.classList.toggle('mode-run', !editing);
  modeEditBtn.setAttribute('aria-pressed', String(editing));
  modeRunBtn.setAttribute('aria-pressed', String(!editing));
  modeGlyph.textContent = editing ? '✎' : '🔒';
  modeGlyph.title = editing
    ? 'Edit mode (⌘E) — drag boxes, draw cords'
    : 'Run mode (⌘E) — the patch is locked; the widgets are live';
  // The controller first: setMode() there aborts anything mid-gesture before applying
  // the lock to the view, and is idempotent — so if it has already been told (⌘E is
  // handled in both places, by design) this call does nothing and the one below is the
  // no-op instead.
  input?.setMode(next);
  view?.setMode(next);
  for (const fn of modeListeners) fn(next);
}

// ─────────────────────────────────────────────────────────────────────────────
// Panes. Below 1280px the palette is a rail whatever the preference says and ⌘K floats
// it over the canvas instead; below 900px the inspector does the same. The persisted
// `palette.open` is only ever written by the wide-window path, so shrinking the window,
// using the overlay and growing it again gives the pane back exactly as it was left.
// ─────────────────────────────────────────────────────────────────────────────

const narrow = matchMedia('(max-width: 1279px)');
const compact = matchMedia('(max-width: 900px)');

function setPaletteOpen(open: boolean): void {
  document.body.dataset.palette = open ? 'open' : 'closed';
  paletteToggle.setAttribute('aria-expanded', String(open));
  writePref('palette.open', String(open));
}

function setInspectorPinned(pinned: boolean): void {
  document.body.dataset.inspector = pinned ? 'pinned' : 'hidden';
  inspectorPin.setAttribute('aria-pressed', String(pinned));
  writePref('inspector.pinned', String(pinned));
}

function setOverlay(which: 'palette' | 'inspector', on: boolean): void {
  document.body.classList.toggle(`overlay-${which}`, on);
  scrimEl.hidden =
    !document.body.classList.contains('overlay-palette') &&
    !document.body.classList.contains('overlay-inspector');
}

function closeOverlays(): void {
  setOverlay('palette', false);
  setOverlay('inspector', false);
}

function togglePalette(): void {
  if (narrow.matches) {
    setOverlay('palette', !document.body.classList.contains('overlay-palette'));
  } else {
    setPaletteOpen(document.body.dataset.palette !== 'open');
  }
}

function toggleInspector(): void {
  if (compact.matches) {
    setOverlay('inspector', !document.body.classList.contains('overlay-inspector'));
  } else {
    setInspectorPinned(document.body.dataset.inspector !== 'pinned');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer: 0 (collapsed) to 45% of the window, drag-resizable by its top edge.
// ─────────────────────────────────────────────────────────────────────────────

const DRAWER_MIN = 120;
const DRAWER_DEFAULT = 220;

const drawerCeiling = (): number => Math.max(DRAWER_MIN, Math.round(window.innerHeight * 0.45));

let drawerHeight = DRAWER_DEFAULT;

function setDrawerHeight(px: number, persist: boolean): void {
  drawerHeight = Math.min(Math.max(Math.round(px), DRAWER_MIN), drawerCeiling());
  document.body.style.setProperty('--drawer-h', `${drawerHeight}px`);
  if (persist) writePref('drawer.height', String(drawerHeight));
}

function setDrawerOpen(open: boolean): void {
  document.body.dataset.drawer = open ? 'open' : 'closed';
  drawerToggle.setAttribute('aria-expanded', String(open));
  writePref('drawer.open', String(open));
}

function toggleDrawer(): void {
  setDrawerOpen(document.body.dataset.drawer !== 'open');
}

function beginDrawerResize(down: PointerEvent): void {
  if (document.body.dataset.drawer !== 'open') return;
  down.preventDefault();
  drawerGrip.setPointerCapture(down.pointerId);
  const startY = down.clientY;
  const startH = drawerHeight;
  // Dragging UP grows the drawer, so the delta is inverted. Not persisted per move —
  // one write on release is enough, and localStorage writes are synchronous.
  const move = (m: PointerEvent): void => setDrawerHeight(startH + (startY - m.clientY), false);
  const end = (up: PointerEvent): void => {
    drawerGrip.releasePointerCapture(up.pointerId);
    drawerGrip.removeEventListener('pointermove', move);
    drawerGrip.removeEventListener('pointerup', end);
    drawerGrip.removeEventListener('pointercancel', end);
    writePref('drawer.height', String(drawerHeight));
  };
  drawerGrip.addEventListener('pointermove', move);
  drawerGrip.addEventListener('pointerup', end);
  drawerGrip.addEventListener('pointercancel', end);
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine + document
// ─────────────────────────────────────────────────────────────────────────────

let engine: Engine | null = null;
let doc: PatchDoc | null = null;
let view: PatcherView | null = null;
let detachTips: (() => void) | null = null;
let input: Interaction | null = null;
let viewFactory: ViewFactory | null = null;
let unsubscribeDoc: (() => void) | null = null;
let lastBuilt: Map<string, MaxNode> = new Map();
let currentName = 'Untitled.maxpat';

/**
 * The page's one Engine, built lazily so the AudioContext is constructed on the way to
 * the first patch rather than at import time — and then kept forever. Never disposed:
 * see the module header.
 */
async function audioEngine(): Promise<Engine> {
  if (!engine) {
    engine = new Engine();
    await preloadWorklets(engine.ctx);
  }
  return engine;
}

/**
 * What the engine can do incrementally, if Phase 5 has landed it.
 *
 * Duck-typed rather than imported, because engine.ts is being extended in parallel and a
 * hard dependency here would make this file un-runnable until that lands. The fallback
 * below is slow but correct, so the page works either way and the fast path switches on
 * by itself the moment the method exists.
 */
interface IncrementalEngine {
  applyOps(ops: readonly Op[], doc: PatchDoc): void;
}

function incremental(e: Engine | null): IncrementalEngine | null {
  const candidate = e as unknown as Partial<IncrementalEngine> | null;
  return candidate && typeof candidate.applyOps === 'function'
    ? (candidate as IncrementalEngine)
    : null;
}

let rebuildQueued = false;

/**
 * FALLBACK, live only until Engine.applyOps exists. A full rebuild per structural edit
 * is heavy — it re-instantiates every object and every widget — but it is honest: the
 * engine really does end up matching the document. `set-rect` is filtered out because
 * dragging a box must never rebuild anything, which is the one part of the incremental
 * contract that is cheap enough to honour here too.
 */
function scheduleRebuild(): void {
  if (rebuildQueued) return;
  rebuildQueued = true;
  queueMicrotask(() => {
    rebuildQueued = false;
    if (!doc || !engine) return;
    const report = engine.build(doc.toIR());
    // Assigned BEFORE the refresh: the view's widgetFor closure reads this map, so the
    // order is what decides whether it re-mounts the new elements or the orphaned ones.
    lastBuilt = report.built;
    view?.refreshWidgets();
    reportBuild(currentName, report);
  });
}

/**
 * Ops that can change which DOM element (if any) an object owns: a box that was just
 * created, retyped, or deleted. `set-rect` is deliberately absent — that is the whole
 * point of the incremental path.
 */
function touchesWidgets(ops: readonly Op[]): boolean {
  return ops.some(
    (op) => op.t === 'add-node' || op.t === 'set-box' || op.t === 'remove-node' || op.t === 'renumber'
  );
}

function onDocChange(ops: readonly Op[]): void {
  const inc = incremental(engine);
  if (inc && doc) {
    inc.applyOps(ops, doc);
    // ORDER, and it is not incidental: PatcherView subscribed to the document in its
    // constructor, which is BEFORE this listener was registered, so it has already
    // drawn the new box — at a moment when the engine had not yet instantiated the
    // object and `widgetFor` therefore had nothing to hand back. Typing `slider` into a
    // box left a box with no slider in it until the next full rebuild. Re-reading the
    // widgets here closes that gap; refreshWidgets() only touches boxes whose element
    // actually changed identity, so this costs nothing for the ops that mount none.
    if (touchesWidgets(ops)) view?.refreshWidgets();
  } else if (ops.some((op) => op.t !== 'set-rect')) {
    scheduleRebuild();
  }
  updateDocMeta();
}

/**
 * Announce a full build. Past tense, and deliberately WITHOUT box/cord counts.
 *
 * The status line is a log of events; #doc-meta is the live summary. When this message
 * also carried "N objects · M cords · K playable" it sat there unchanged while the user
 * typed three boxes, reading as a present-tense claim about a document it no longer
 * described — with the correct numbers on screen right beside it. What belongs here is
 * only what a build reports and nothing else can: which classes came up as stubs and
 * which are not in the manifest at all.
 */
function reportBuild(name: string, report: BuildReport): void {
  if (!doc) return;
  const parts = [`Opened ${name}`];
  if (report.stubbed.length) parts.push(`stubbed: ${report.stubbed.join(', ')}`);
  if (report.unknown.length) parts.push(`unknown: ${report.unknown.join(', ')}`);
  status(parts.join(' · '), 'ok');
  updateDocMeta();
}

/**
 * Tear down the view and the gestures bound to it, in that dependency order: the
 * controller's listeners live on the view's <svg>, so the controller goes first.
 */
function unmountView(): void {
  detachTips?.();
  detachTips = null;
  input?.destroy();
  input = null;
  view?.destroy();
  view = null;
}

function mountView(): void {
  unmountView();
  if (!viewFactory || !doc) {
    updateZoom();
    return;
  }
  view = viewFactory(canvasEl, doc, lastBuilt);
  view.setMode(mode);
  view.fit();
  // The controller is bound to the view, not to the shell, and is therefore rebuilt
  // with it. `built` is a thunk rather than the map itself: today Engine.build() hands
  // back the engine's own live Map, so a captured reference would happen to stay
  // correct — but that is the engine's implementation detail, and reading `lastBuilt`
  // through a closure costs nothing and stays right if it ever stops being true.
  input = new Interaction({
    doc,
    view,
    onStatus: (message) => status(message),
    built: () => lastBuilt,
  });
  // What an inlet MEANS, after a dwell. Independent of the controller on purpose: it
  // consumes no event and touches no document, so it can be attached and detached with
  // the view and nothing else has to know it exists.
  detachTips = attachPortTips({ svg: view.svg, doc: () => doc });
  updateZoom();
}

/**
 * Replace the document. Order matters: drop the old subscription and view BEFORE the
 * new engine build, so a listener can't be called about a document that is on its way
 * out, and build BEFORE the view is created, so the widget elements the view has to
 * mount already exist.
 */
async function adopt(next: PatchDoc, name: string): Promise<void> {
  unsubscribeDoc?.();
  unsubscribeDoc = null;
  unmountView();

  doc = next;
  currentName = name;
  const eng = await audioEngine();
  const report = eng.build(next.toIR());
  lastBuilt = report.built;
  mountView();
  unsubscribeDoc = next.on(onDocChange);
  reportBuild(name, report);
}

async function newPatch(): Promise<void> {
  await adopt(await PatchDoc.create({ ...EMPTY_PATCHER_HEADER }), 'Untitled.maxpat');
}

async function loadPatch(json: unknown, name: string): Promise<void> {
  await adopt(await PatchDoc.open(parseMaxPat(json)), name);
}

async function openFile(file: File): Promise<void> {
  try {
    await loadPatch(JSON.parse(await file.text()), file.name);
  } catch (err) {
    status(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
  }
}

/**
 * Write the document out as .maxpat.
 *
 * SEAM (Phase 7): ui/file-io.ts replaces this with the File System Access API so ⌘S
 * re-saves in place instead of dropping a new file in ~/Downloads every time. This is
 * the fallback that module will keep for browsers without it, so it is not throwaway.
 * `renumber` because the document's ids go sparse as you edit and a saved file should
 * not show the holes.
 */
function save(): void {
  if (!doc) return;
  const name = currentName.endsWith('.maxpat') ? currentName : `${currentName}.maxpat`;
  const blob = new Blob([JSON.stringify(patchToMaxPat(doc, { renumber: true }), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  status(`Saved ${name}`, 'ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// Zoom. The buttons drive the view; the readout follows both them and whatever the
// user does with the wheel, which the view announces as a `patcher:zoom` event.
// ─────────────────────────────────────────────────────────────────────────────

function updateZoom(): void {
  const has = view !== null;
  for (const b of [zoomInBtn, zoomOutBtn, zoomLevelBtn, zoomFitBtn]) b.disabled = !has;
  const z = view ? view.viewport.zoom : NaN;
  zoomLevelBtn.textContent = Number.isFinite(z) && z > 0 ? `${Math.round(z * 100)}%` : '100%';
}

/**
 * Zoom to an absolute scale about the CENTRE of the canvas, so the thing the user was
 * looking at is still the thing in the middle.
 *
 * Written in two setViewport() calls rather than one because the renderer owns the
 * zoom limits: the second call uses the scale that actually took effect, so the
 * translation stays exact at the ends of the range instead of drifting by whatever the
 * clamp removed. (The wheel zoom is the controller's; it zooms about the CURSOR, which
 * is the right anchor for that gesture and the wrong one for a toolbar button.)
 */
function zoomTo(scale: number): void {
  if (!view) return;
  const before = view.viewport;
  view.setViewport({ ...before, zoom: scale });
  const after = view.viewport.zoom;
  const box = canvasEl.getBoundingClientRect();
  const cx = box.width / 2;
  const cy = box.height / 2;
  const k = after / before.zoom;
  view.setViewport({ x: cx - (cx - before.x) * k, y: cy - (cy - before.y) * k, zoom: after });
  updateZoom();
}

const zoomBy = (factor: number): void => zoomTo((view?.viewport.zoom ?? 1) * factor);

function zoomFit(): void {
  view?.fit();
  updateZoom();
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup patch
// ─────────────────────────────────────────────────────────────────────────────

const STARTER = 'test-patches/hello_world.maxpat';

/**
 * Resolve a `?patch=` value to a URL under the deploy base. A bare name is taken as one
 * of the bundled samples, so `?patch=fm_synth` works.
 *
 * The value is attacker-supplied, so anything that could make this page fetch somewhere
 * else — an absolute URL, a scheme, a parent-directory escape — is refused rather than
 * normalized. There is no case where following one would be doing the user a favour.
 */
function sampleUrl(param: string): string {
  const path = /\.(maxpat|json)$/i.test(param) ? param : `test-patches/${param}.maxpat`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`refusing to load ?patch=${param} from outside this site`);
  }
  if (path.split('/').includes('..')) throw new Error(`refusing to load ?patch=${param}`);
  return import.meta.env.BASE_URL + path;
}

async function loadUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  await loadPatch(await res.json(), name);
}

/**
 * Startup precedence: `?patch=<sample>` → the bundled starter.
 *
 * SEAM (Phase 7): a `#p=` permalink goes in FRONT of ?patch=, and the localStorage
 * autosave slot goes between ?patch= and the starter (restored behind a dismissible
 * "Restored your last patch · Start fresh" bar). Neither exists yet and neither is
 * stubbed here — a fake restore would be worse than none.
 */
async function boot(): Promise<void> {
  const param = new URLSearchParams(location.search).get('patch');
  if (param) {
    try {
      await loadUrl(sampleUrl(param), param);
      return;
    } catch (err) {
      status(`Could not load ?patch=${param}: ${(err as Error).message}`, 'error');
    }
  }
  try {
    await loadUrl(import.meta.env.BASE_URL + STARTER, 'hello_world.maxpat');
  } catch {
    // Offline, or the sample was not deployed: an empty canvas still works.
    await newPatch();
    status('Started an empty patch.', 'info');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────────

modeEditBtn.addEventListener('click', () => setMode('edit'));
modeRunBtn.addEventListener('click', () => setMode('run'));

startBtn.addEventListener('click', () => {
  void (async () => {
    const eng = await audioEngine();
    await eng.start();
    startBtn.classList.add('is-live');
    stopBtn.disabled = false;
    status('Audio running.', 'ok');
  })();
});

stopBtn.addEventListener('click', () => {
  void engine?.stop();
  startBtn.classList.remove('is-live');
  stopBtn.disabled = true;
  status('Audio stopped.');
});

newBtn.addEventListener('click', () => void newPatch());
openBtn.addEventListener('click', () => fileInput.click());
saveBtn.addEventListener('click', save);
shareBtn.title = 'Permalinks arrive with the sharing phase';

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openFile(file);
  fileInput.value = ''; // so re-picking the same file fires `change` again
});

// Drop is scoped to the canvas, not the document: the page has other drop targets to
// come (the palette, the Python drawer) and a document-level handler would swallow them.
canvasEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
canvasEl.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const file = e.dataTransfer?.files?.[0];
  if (file) void openFile(file);
});

zoomInBtn.addEventListener('click', () => zoomBy(1.25));
zoomOutBtn.addEventListener('click', () => zoomBy(0.8));
zoomLevelBtn.addEventListener('click', () => zoomTo(1));
zoomFitBtn.addEventListener('click', zoomFit);
canvasEl.addEventListener('patcher:zoom', () => updateZoom());

paletteToggle.addEventListener('click', togglePalette);
inspectorPin.addEventListener('click', toggleInspector);
scrimEl.addEventListener('pointerdown', closeOverlays);
// A floating pane belongs to a narrow window. Growing back out of one must not leave it
// stuck over a canvas that now has room for a real column.
narrow.addEventListener('change', closeOverlays);

drawerToggle.addEventListener('click', toggleDrawer);
drawerGrip.addEventListener('pointerdown', beginDrawerResize);
window.addEventListener('resize', () => setDrawerHeight(drawerHeight, false));

// Shell shortcuts never fire while a text field has focus — ⌘Z belongs to the editor.
// The predicate is imported rather than restated: the gesture controller gates the same
// events on the same question, and two answers that could disagree is a bug waiting to
// happen. In particular a mounted `slider` is an <input type=range> and must NOT count,
// or ⌘E would stop working as soon as you moved a widget in run mode.
window.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || ownsKeyboard(e.target)) return;
  const key = e.key.toLowerCase();
  const act: Record<string, (() => void) | undefined> = {
    e: () => setMode(mode === 'edit' ? 'run' : 'edit'),
    j: toggleDrawer,
    k: togglePalette,
    i: toggleInspector,
    s: save,
    o: () => fileInput.click(),
    '0': zoomFit,
    '=': () => zoomBy(1.25),
    '+': () => zoomBy(1.25),
    '-': () => zoomBy(0.8),
  };
  const run = act[key];
  if (!run) return;
  e.preventDefault();
  run();
});

// ── restore the persisted layout, before the first paint of anything below ──
setPaletteOpen(readPref('palette.open') !== 'false');
setInspectorPinned(readPref('inspector.pinned') !== 'false');
setDrawerHeight(Number(readPref('drawer.height')) || DRAWER_DEFAULT, false);
setDrawerOpen(readPref('drawer.open') === 'true');
setMode('edit');
updateZoom();

const ready = boot();

// ─────────────────────────────────────────────────────────────────────────────
// The shell object. Exported for the integrator, and hung off window so a browser test
// can await `ready` and drive the page without reaching into module scope.
// ─────────────────────────────────────────────────────────────────────────────

export const shell: PatcherShell = {
  get doc() {
    return doc;
  },
  get engine() {
    return engine;
  },
  get view() {
    return view;
  },
  get input() {
    return input;
  },
  get mode() {
    return mode;
  },
  canvas: canvasEl,
  ready,
  setMode,
  toggleMode: () => setMode(mode === 'edit' ? 'run' : 'edit'),
  onModeChange(fn) {
    modeListeners.add(fn);
    return () => modeListeners.delete(fn);
  },
  useRenderer(factory) {
    viewFactory = factory;
    mountView();
  },
  newPatch,
  loadPatch,
  openFile,
  save,
  status,
  togglePalette,
  toggleInspector,
  toggleDrawer,
};

(window as unknown as { __patcher: PatcherShell }).__patcher = shell;

// ─────────────────────────────────────────────────────────────────────────────
// The renderer.
//
// One line, because the shell and ui/patcher.ts now speak the same vocabulary. The
// factory is the whole coupling: the view is told which document to render and how to
// find a box's widget, and everything else — mode, viewport, the gesture controller —
// is driven through the view's own API by mountView() above.
//
// `widgetFor` reads the shell's live `built` map rather than the `built` argument, so
// after a rebuild `view.refreshWidgets()` alone is enough to re-mount whatever changed
// identity. Registered last, so nothing can observe a half-initialized module.
// ─────────────────────────────────────────────────────────────────────────────

shell.useRenderer(
  (host, patch) =>
    new PatcherView(host, {
      doc: patch,
      widgetFor: (id) => lastBuilt.get(id)?.el,
    })
);
