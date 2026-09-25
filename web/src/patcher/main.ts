// The patcher's app shell: the page's one long-lived object graph, and the wiring point
// every other patcher module plugs into.
//
// It deliberately renders nothing. The canvas is drawn by ui/patcher.ts and driven by
// ui/patcher-input.ts; the palette by ui/palette.ts, the inspector by ui/inspector.ts,
// the Python drawer by patcher/python-pane.ts. What lives here is the state that must
// outlive all of them and can only have one owner:
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
//   • THE PYTHON DRAWER, AND WHEN IT IS ALLOWED TO EXIST. patcher/python-pane.ts pulls
//     ~15 MB of Pyodide and ~400 KB of CodeMirror, and most visitors open this page to
//     look at a canvas. So the pane is CONSTRUCTED ON THE DRAWER'S FIRST OPEN and never
//     at load — see ensurePythonPane() — and once constructed it is never destroyed, for
//     the same reason the AudioContext is not: a ▶ Run REPLACES the document, and a pane
//     torn down with its document would re-download a Python runtime on every run.
//     ui/sync.ts sits between the pane and the document and is given a GETTER for the
//     document precisely because the document is replaced underneath it.
//
//   • THE LEVEL STACK. The canvas can show the inside of a `p`/`patcher` box instead of
//     the top document (openSubpatch). `doc` stays the TOP document throughout — Save,
//     Share, autosave, the self-test and the Python drawer all act on it, and so see an
//     edit made inside a subpatcher, because PatchDoc.openSubpatch() writes each one
//     back into the box as it happens. What changes is which document the VIEW, the
//     gesture controller, the palette and the inspector edit (`here().doc`), and which
//     engine's nodes the view mounts widgets from: the nested Engine the `p` box runs its
//     patch on, so a number box inside a playing subpatcher is the live one. Nothing is
//     rebuilt on the way in or out, which is what keeps the patch sounding throughout.
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
import { isSubpatcher } from '../doc/subpatcher';
import { renderTone } from '../engine/selftest';
import { parseMaxPat } from '../parser/maxpat';
import { addSampleFile } from '../objects/audio/samples';
import { decodeMax5Patcher } from '../parser/max5-clipboard';
import { EMPTY_PATCHER_HEADER, patchToMaxPat } from '../parser/write-maxpat';
import { preloadWorklets } from '../runtime/worklet';
import { clearAutosave, installAutosave, loadAutosave } from '../ui/autosave';
import { installCanvasDrop, openMaxpat, PickerCancelled, saveMaxpat } from '../ui/file-io';
import { Inspector } from '../ui/inspector';
import { Palette } from '../ui/palette';
import { PatcherView, type Viewport } from '../ui/patcher';
import { Interaction, ownsKeyboard } from '../ui/patcher-input';
import {
  buildPermalink,
  PermalinkTooLargeError,
  readPermalinkFromLocation,
  type Permalink,
} from '../ui/permalink';
import { closeSharePopover, openSharePopover } from '../ui/share-popover';
import { SyncController } from '../ui/sync';
import { attachPortTips } from '../ui/tooltip';
// Static, and it stays that way: python-pane.ts has type-only static imports of its own,
// so this costs ~11 KB in the shell's chunk and pulls in neither CodeMirror nor Pyodide
// — both of which it loads through dynamic import(), from its constructor and from
// preload() respectively. Constructing it is what starts the download; importing it is
// not. See ensurePythonPane().
import { PythonPane } from './python-pane';

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
  /**
   * The current TOP-LEVEL document. Replaced by newPatch()/loadPatch(), never mutated
   * here — and still the top one while a subpatcher is open on the canvas.
   */
  readonly doc: PatchDoc | null;
  /** The document the canvas is showing: `doc`, or the inside of an open subpatcher. */
  readonly viewDoc: PatchDoc | null;
  /** Box ids from the top document down to the open subpatcher; [] at the top level. */
  readonly subpatchPath: readonly string[];
  /** Show the inside of the `p`/`patcher` box `id` of the document on the canvas. */
  openSubpatch(id: string): boolean;
  /** Go up `levels` subpatchers (default one). False when already at the top. */
  back(levels?: number): boolean;
  /** The page's single Engine. Null only before the first load completes. */
  readonly engine: Engine | null;
  /** #patcher-canvas — carries `patcher mode-edit|mode-run`. The view mounts INSIDE it. */
  readonly canvas: HTMLElement;
  readonly view: PatcherView | null;
  /** The gesture controller bound to the current view's <svg>. Null with no view. */
  readonly input: Interaction | null;
  /** The Python drawer, once it has been opened. Null until then — that is the point. */
  readonly python: PythonPane | null;
  /** The ownership state machine between the canvas and the drawer. Null with no pane. */
  readonly sync: SyncController | null;
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
const subpatchBar = el('subpatch-bar');
const subpatchCrumbs = el('subpatch-crumbs');
const subpatchBackBtn = el<HTMLButtonElement>('subpatch-back');

const modeEditBtn = el<HTMLButtonElement>('mode-edit');
const modeRunBtn = el<HTMLButtonElement>('mode-run');
const modeGlyph = el('mode-glyph');

const startBtn = el<HTMLButtonElement>('start');
const stopBtn = el<HTMLButtonElement>('stop');
const selftestBtn = el<HTMLButtonElement>('selftest');

const newBtn = el<HTMLButtonElement>('file-new');
const newFromClipboardBtn = el<HTMLButtonElement>('file-new-clipboard');
const openBtn = el<HTMLButtonElement>('file-open');
const saveBtn = el<HTMLButtonElement>('file-save');
const saveAsBtn = el<HTMLButtonElement>('file-save-as');
const shareBtn = el<HTMLButtonElement>('file-share');
const samplesSelect = el<HTMLSelectElement>('samples');

const restoreBar = el('restore-bar');
const restoreText = el('restore-text');
const restoreFreshBtn = el<HTMLButtonElement>('restore-fresh');
const restoreDismissBtn = el<HTMLButtonElement>('restore-dismiss');

const zoomInBtn = el<HTMLButtonElement>('zoom-in');
const zoomOutBtn = el<HTMLButtonElement>('zoom-out');
const zoomLevelBtn = el<HTMLButtonElement>('zoom-level');
const zoomFitBtn = el<HTMLButtonElement>('zoom-fit');

const paletteToggle = el<HTMLButtonElement>('palette-toggle');
const inspectorPin = el<HTMLButtonElement>('inspector-pin');
const themeToggle = el<HTMLButtonElement>('theme-toggle');
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
  // The counts describe what is on the canvas; the revision is the top document's,
  // because that is the one that saves.
  const shown = here()?.doc ?? doc;
  let playable = 0;
  for (const node of shown.nodes()) if (isSupported(node.className)) playable++;
  docMetaEl.textContent =
    `${shown.nodeCount} boxes · ${shown.edgeCount} cords · ${playable} playable` +
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

/**
 * Theme. LIGHT IS THE DEFAULT because Max's patcher is light, and looking like Max is
 * the point of this app; the system's prefers-color-scheme is deliberately not consulted.
 *
 * The attribute lives on <html>, not <body>, so the inline script in index.html can stamp
 * it before the stylesheet resolves and neither theme ever flashes the other. Everything
 * downstream is CSS: ui/patcher.css redefines its tokens under :root[data-theme='dark'],
 * and the canvas repaints without the renderer being told anything happened, because a
 * CSS rule outranks the presentation attributes ui/patcher.ts writes.
 */
type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function setTheme(theme: Theme, persist = true): void {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  // The glyph shows what you get by pressing it, not what you are in — the same way the
  // mode switch names the destination.
  themeToggle.textContent = theme === 'dark' ? '☀' : '🌙';
  themeToggle.setAttribute(
    'title',
    theme === 'dark' ? 'Switch to the light (Max-like) theme' : 'Switch to the dark theme'
  );
  if (persist) writePref('theme', theme);
}

function setPaletteOpen(open: boolean): void {
  document.body.dataset.palette = open ? 'open' : 'closed';
  paletteToggle.setAttribute('aria-expanded', String(open));
  writePref('palette.open', String(open));
}

function setInspectorPinned(pinned: boolean, persist = true): void {
  document.body.dataset.inspector = pinned ? 'pinned' : 'hidden';
  inspectorPin.setAttribute('aria-pressed', String(pinned));
  // Opening the pane because something got selected must not rewrite the user's stored
  // preference — otherwise one click on a box permanently changes a setting they chose.
  if (persist) writePref('inspector.pinned', String(pinned));
}

/**
 * Whether the pane currently on screen was opened by a selection rather than by the user.
 * Only an auto-opened pane is auto-closed again: someone who pinned it deliberately keeps
 * it, empty, rather than watching it flap shut every time they click the background.
 */
let inspectorAutoShown = false;

/** Show the inspector for a new selection, if it is not already up. */
function revealInspector(): void {
  // Below 900px the pane is a scrimmed overlay ON TOP of the canvas. Auto-raising that on
  // every click would cover the patch the user just clicked in, so there it stays manual.
  if (compact.matches || document.body.dataset.inspector === 'pinned') return;
  inspectorAutoShown = true;
  setInspectorPinned(true, false);
}

/** Put an auto-opened inspector away once nothing is selected. */
function retractInspector(): void {
  if (!inspectorAutoShown) return;
  inspectorAutoShown = false;
  setInspectorPinned(false, false);
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
  // Touching the toggle is the user taking over: from here the pane stays where they put
  // it, and clearing the selection no longer folds it away.
  inspectorAutoShown = false;
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
  // THE ONE PLACE the Python pane comes into existence. Opening the drawer is the user
  // saying they want Python; nothing before it may cost them a runtime download. This
  // also covers a drawer restored open from a previous session — the pane must not be
  // an empty rectangle there — which is why the check lives in the setter and not in
  // toggleDrawer().
  if (open) ensurePythonPane();
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
 * One document the canvas can show. levels[0] is the top document; each further entry
 * is the inside of a `p` box of the one before it, opened with PatchDoc.openSubpatch().
 */
interface Level {
  doc: PatchDoc;
  /** The box in the previous level this is the inside of. Absent for the top level. */
  boxId?: string;
  /** The breadcrumb: the file name, then each box's text. */
  label: string;
  /** Where this level's canvas was looking when a subpatcher was opened from it. */
  viewport?: Viewport;
  /** Stop watching the parent for the box going away. */
  unwatch?: () => void;
}

let levels: Level[] = [];

/** The level on the canvas, or undefined before the first document. */
const here = (): Level | undefined => levels[levels.length - 1];

/**
 * The file this document came from, when the browser gave us a handle for it.
 *
 * This is what makes ⌘S re-save in place rather than drop `fm_synth (7).maxpat` into
 * ~/Downloads. Cleared by adopt() for every document, and re-assigned by openPatch()
 * AFTER the load — one rule, so no caller has to remember the ordering.
 */
let fileHandle: FileSystemFileHandle | undefined;
/** Uninstall thunk for the autosave install belonging to the CURRENT document. */
let stopAutosave: (() => void) | null = null;

// The three panes. The palette and the inspector are built once, at the bottom of this
// file, and outlive every document (neither holds one). The Python pane is built on the
// drawer's first open and then also outlives every document — see the module header.
let palette: Palette | null = null;
let inspector: Inspector | null = null;
let pane: PythonPane | null = null;
let sync: SyncController | null = null;

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
    (op) =>
      op.t === 'add-node' ||
      op.t === 'set-box' ||
      op.t === 'remove-node' ||
      op.t === 'renumber' ||
      // An edit inside a subpatcher mounts widgets only if the canvas is showing it; a
      // refresh is cheap either way (it touches only boxes whose element changed).
      (op.t === 'sub' && touchesWidgets(op.ops))
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
  // ONCE PER TRANSACTION, not once per op: doc.on() already batches, and the sync
  // controller counts what it is handed as "one canvas edit" — a per-op call would
  // report a three-box paste as three.
  sync?.onCanvasChanged();
  // The inspector shows the selected box, and an edit to it can come from anywhere —
  // the canvas, ⌘Z, or the Python drawer. Re-showing is cheap: a node whose only change
  // is its rect takes the pane's in-place path and rebuilds no DOM.
  refreshInspector();
}

// ─────────────────────────────────────────────────────────────────────────────
// The panes
// ─────────────────────────────────────────────────────────────────────────────

/** Where a box goes when nothing said where: the visible middle of the canvas. */
function canvasCentre(): { x: number; y: number } {
  if (!view) return { x: 60, y: 60 };
  const box = canvasEl.getBoundingClientRect();
  return view.clientToPatch({
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
  });
}

/** Screen point (a drop, say) to patch coordinates, through the live viewport. */
function toPatch(at: { clientX: number; clientY: number }): { x: number; y: number } {
  return view ? view.clientToPatch(at) : { x: 60, y: 60 };
}

/**
 * Create a box, and select it — placing an object the user cannot then see the
 * properties of is half a gesture. Rounded because patching_rect coordinates are
 * written to the file and a dropped box should not arrive at x = 213.60000000000002.
 */
function placeObject(name: string, at: { x: number; y: number }): void {
  const target = here()?.doc;
  if (!target) return;
  const node = target.addBox(name, Math.round(at.x), Math.round(at.y));
  view?.select([node.id]);
  status(`Placed ${name}`);
}

/** Point the inspector at whatever is selected now. */
function showSelection(ids: ReadonlySet<string>): void {
  if (!inspector) return;
  if (ids.size === 0 || !doc) {
    inspector.hide();
    retractInspector();
    return;
  }
  if (ids.size > 1) {
    inspector.showMulti([...ids]);
    revealInspector();
    return;
  }
  const id = [...ids][0];
  const node = here()?.doc.node(id);
  if (node) {
    inspector.show(node, builtHere().get(id));
    revealInspector();
  } else {
    inspector.hide();
    retractInspector();
  }
}

function refreshInspector(): void {
  if (view) showSelection(view.selection);
  else inspector?.hide();
}

/**
 * Build the Python drawer, once, on the drawer's first open.
 *
 * Everything expensive is downstream of this call: the pane's constructor imports
 * CodeMirror and preload() starts Pyodide. Nothing above calls it, and nothing here may
 * start calling it from page load — see the module header.
 *
 * The controller is handed a GETTER for the document because a ▶ Run replaces the
 * document wholesale, and it is handed loadPatch() so that replacement runs through the
 * same path as Open — including the engine rebuild, the autosave install and the view.
 */
function ensurePythonPane(): void {
  if (pane) return;
  const host = el('drawer-body');
  const built = new PythonPane(host, {
    onRun: (json) => sync?.onPythonRun(json),
    onStatus: (msg, kind) => status(msg, kind ?? 'info'),
    onEdit: () => sync?.onPythonEdited(),
  });
  pane = built;
  sync = new SyncController({
    doc: () => doc,
    pane: built,
    onBanner: (state) => built.setNotice(state),
    // Named after what the script itself saves, not after whatever file was open: a
    // ▶ Run produces the script's patch, and calling it `fm_synth.maxpat` afterwards
    // would be a claim about a file this document is no longer a copy of.
    loadPatch: (json) => loadPatch(json, PY_FILENAME),
    codegen: { filename: PY_FILENAME },
  });
  void built.preload(); // the ~15 MB download, and the only place it can start
  sync.adopt(); // seed the pane: generated code, read-only, with [Detach & edit]
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

function mountView(restore?: Viewport): void {
  unmountView();
  renderCrumbs();
  const level = here();
  if (!viewFactory || !level) {
    updateZoom();
    return;
  }
  view = viewFactory(canvasEl, level.doc, builtHere());
  view.setMode(mode);
  if (restore) view.setViewport(restore);
  else view.fit();
  // The controller is bound to the view, not to the shell, and is therefore rebuilt
  // with it. `built` is a thunk rather than the map itself: today Engine.build() hands
  // back the engine's own live Map, so a captured reference would happen to stay
  // correct — but that is the engine's implementation detail, and reading `lastBuilt`
  // through a closure costs nothing and stays right if it ever stops being true.
  input = new Interaction({
    doc: level.doc,
    view,
    onStatus: (message) => status(message),
    built: () => builtHere() as Map<string, MaxNode>,
    onOpenSubpatch: (id) => void openSubpatch(id),
    onBack: () => back(),
  });
  // What an inlet MEANS, after a dwell. Independent of the controller on purpose: it
  // consumes no event and touches no document, so it can be attached and detached with
  // the view and nothing else has to know it exists.
  detachTips = attachPortTips({ svg: view.svg, doc: () => here()?.doc ?? null });
  updateZoom();
  // A new view starts with nothing selected; say so, rather than leaving the inspector
  // showing a box from the document that was just replaced.
  refreshInspector();
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
  // NOT flushed: uninstalling means the document is being replaced, and flushing here
  // would make a reload restore the patch the user just closed. See ui/autosave.ts.
  stopAutosave?.();
  stopAutosave = null;
  unmountView();
  restoreBar.hidden = true;
  // Whatever file the LAST document came from is not this one's. openPatch() re-assigns
  // after its load; every other path genuinely has no handle.
  fileHandle = undefined;

  // Opening anything returns the canvas to the top level: the subpatchers open on the
  // old document belong to it, and stop following it here.
  closeLevels(0);
  levels = [{ doc: next, label: name }];
  doc = next;
  currentName = name;
  const eng = await audioEngine();
  const report = eng.build(next.toIR());
  lastBuilt = report.built;
  mountView();
  unsubscribeDoc = next.on(onDocChange);
  stopAutosave = installAutosave(() => patchToMaxPat(next, { renumber: true }), {
    subscribe: (changed) => next.on(changed),
    name: () => currentName,
    onError: (message) => status(message, 'error'),
  });
  // The drawer, if it is open, is showing a projection of a document that no longer
  // exists. Only while the canvas owns it: a script the user typed is theirs, and a
  // document swap is not a reason to overwrite it.
  if (sync?.owner === 'canvas') sync.adopt();
  reportBuild(name, report);
}

// ─────────────────────────────────────────────────────────────────────────────
// Subpatchers: the canvas showing the inside of a `p` box. See the module header.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live nodes of the engine running the level on the canvas: the page engine at the
 * top, the nested Engine of each `p` box on the way down otherwise.
 *
 * Resolved on every call, from the top, rather than captured when the level was
 * opened: the nested engine belongs to the `p` box's node, and anything that
 * re-instantiates that node (a rebuild) makes a new one. An empty map when the box never
 * built — the canvas still shows and edits the inside, it just has no widgets to mount.
 */
function builtHere(): ReadonlyMap<string, MaxNode> {
  if (levels.length <= 1) return lastBuilt;
  let nodes: ReadonlyMap<string, MaxNode> = lastBuilt;
  for (const level of levels.slice(1)) {
    const inner = nodes.get(level.boxId ?? '')?.subpatch?.engine;
    if (!inner) return new Map();
    nodes = inner.built;
  }
  return nodes;
}

/** Drop every level deeper than `depth`, innermost first. Touches no view. */
function closeLevels(depth: number): void {
  while (levels.length > depth + 1) {
    const level = levels.pop()!;
    level.unwatch?.();
    level.doc.close();
  }
}

/**
 * Show the inside of the `p`/`patcher` box `id` of the document on the canvas.
 *
 * Nothing about the audio changes: the engine is not rebuilt and the box's nested engine
 * keeps running; only the view and its gesture controller are swapped for ones over the
 * subpatcher's document. The parent's viewport is kept so Back lands where the user was.
 */
function openSubpatch(id: string): boolean {
  const parent = here();
  const node = parent?.doc.node(id);
  if (!parent || !node || !isSubpatcher(node)) return false;
  parent.viewport = view?.viewport;
  const child = parent.doc.openSubpatch(id);
  const level: Level = { doc: child, boxId: id, label: node.text.trim() || node.className };
  // The box can go away underneath an open subpatcher — a Python ▶ Run replaces the
  // whole document (adopt() handles that), but the box can also be retyped or deleted
  // at its own level by an undo reaching past the subpatcher. The inside is then no
  // longer anything's, so the canvas returns to the level that still exists.
  level.unwatch = parent.doc.on((ops) => {
    const gone = ops.some(
      (op) =>
        (op.t === 'remove-node' && op.node.id === id) ||
        (op.t === 'set-box' && op.id === id) ||
        op.t === 'renumber'
    );
    const at = levels.indexOf(level);
    if (gone && at > 0) {
      const keep = levels[at - 1];
      closeLevels(at - 1);
      mountView(keep.viewport);
      status(`${level.label} is no longer in the patch — back in ${keep.label}.`, 'info');
    }
  });
  levels.push(level);
  mountView();
  view?.svg.focus();
  updateDocMeta();
  status(`Opened ${level.label} — Esc or ‹ Back to return.`);
  return true;
}

/** Go up `count` levels (at most to the top). False when already at the top. */
function back(count = 1): boolean {
  if (levels.length <= 1) return false;
  const depth = Math.max(0, levels.length - 1 - count);
  const keep = levels[depth];
  closeLevels(depth);
  mountView(keep.viewport);
  view?.svg.focus();
  updateDocMeta();
  status(`Back in ${depth === 0 ? currentName : keep.label}.`);
  return true;
}

/** The breadcrumb bar: hidden at the top level, one crumb per level below it. */
function renderCrumbs(): void {
  subpatchBar.hidden = levels.length <= 1;
  subpatchCrumbs.replaceChildren();
  if (levels.length <= 1) return;
  levels.forEach((level, i) => {
    const li = document.createElement('li');
    const last = i === levels.length - 1;
    const label = i === 0 ? currentName : level.label;
    if (last) {
      const span = document.createElement('span');
      span.textContent = label;
      span.setAttribute('aria-current', 'page');
      li.appendChild(span);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.depth = String(i);
      button.title = i === 0 ? 'Back to the top-level patch' : `Back to ${label}`;
      button.addEventListener('click', () => back(levels.length - 1 - i));
      li.appendChild(button);
    }
    subpatchCrumbs.appendChild(li);
  });
}

async function newPatch(): Promise<void> {
  await adopt(await PatchDoc.create({ ...EMPTY_PATCHER_HEADER }), 'Untitled.maxpat');
}

async function loadPatch(json: unknown, name: string): Promise<void> {
  await adopt(await PatchDoc.open(parseMaxPat(json)), name);
}

/**
 * Max's File > New From Clipboard: a fresh document built from whatever patch is on the
 * clipboard. Accepts what Max's own copy writes (a compressed `begin_max5_patcher`
 * block), a whole .maxpat (`{patcher: …}`), or a bare `{boxes, lines}` fragment — the shape this patcher's own ⌘C writes — which is wrapped in an empty
 * patcher header so it opens as a document of its own rather than pasting into this one.
 */
async function newFromClipboard(): Promise<void> {
  let text: string;
  try {
    text = (await navigator.clipboard.readText()).trim();
  } catch {
    status('Could not read the clipboard — the browser did not allow it.', 'error');
    return;
  }
  // Max itself copies as a compressed `begin_max5_patcher` block, not as JSON.
  try {
    text = (await decodeMax5Patcher(text)) ?? text;
  } catch (err) {
    status(`Could not read the Max patch on the clipboard: ${(err as Error).message}`, 'error');
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    status('The clipboard does not hold a Max patch — copy one in Max, or copy .maxpat JSON.', 'error');
    return;
  }
  const root = json as { patcher?: unknown; boxes?: unknown; lines?: unknown } | null;
  if (root && typeof root === 'object' && !root.patcher && Array.isArray(root.boxes)) {
    json = {
      patcher: {
        ...EMPTY_PATCHER_HEADER,
        boxes: root.boxes,
        lines: Array.isArray(root.lines) ? root.lines : [],
      },
    };
  } else if (!root || typeof root !== 'object' || !root.patcher) {
    status('The clipboard does not hold a Max patch — copy one in Max, or copy .maxpat JSON.', 'error');
    return;
  }
  try {
    await loadPatch(json, 'Untitled.maxpat');
  } catch (err) {
    status(`Could not open the clipboard patch: ${(err as Error).message}`, 'error');
  }
}

/**
 * Sound files dropped on the canvas: make each available under its own name, which is
 * how a patch refers to them — every playlist~ clip with that file name picks it up.
 * A file no clip names is still kept, and appears in every clip's menu.
 */
async function addAudioFiles(files: File[]): Promise<void> {
  const clipNames = new Set<string>();
  for (const node of doc?.nodes() ?? []) {
    const clips = (node.raw?.data as { clips?: { filename?: unknown }[] } | undefined)?.clips;
    if (node.className !== 'playlist~' || !Array.isArray(clips)) continue;
    for (const c of clips) if (typeof c?.filename === 'string') clipNames.add(c.filename.toLowerCase());
  }
  try {
    for (const file of files) addSampleFile(file.name, await file.arrayBuffer());
  } catch (err) {
    status(`Could not read that audio file: ${(err as Error).message}`, 'error');
    return;
  }
  const matched = files.filter((f) => clipNames.has(f.name.toLowerCase())).map((f) => f.name);
  const unmatched = files.filter((f) => !clipNames.has(f.name.toLowerCase())).map((f) => f.name);
  status(
    [
      matched.length ? `Loaded ${matched.join(', ')} — playing in the clips that name it.` : '',
      unmatched.length
        ? `Loaded ${unmatched.join(', ')}; no clip is named that — pick it from a clip's menu in 🔒 Run mode.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    'ok'
  );
}

async function openFile(file: File): Promise<void> {
  try {
    await loadPatch(JSON.parse(await file.text()), file.name);
  } catch (err) {
    status(`Could not open ${file.name}: ${(err as Error).message}`, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File I/O. Everything that leaves or enters the page as a file or a link.
//
// `renumber: true` on every write: the document's ids go sparse as you edit, and a saved
// file should not show the holes — nor should a permalink, nor the autosave slot, so all
// three ask for the same thing.
// ─────────────────────────────────────────────────────────────────────────────

const fileName = (): string =>
  currentName.endsWith('.maxpat') ? currentName : `${currentName}.maxpat`;

async function openPatch(): Promise<void> {
  try {
    const picked = await openMaxpat();
    if (!picked) return; // the user dismissed the picker; nothing to say about it
    await loadPatch(picked.json, picked.name);
    // AFTER the load: adopt() clears the handle for every document, so assigning it
    // before would set it on the one being replaced.
    fileHandle = picked.handle;
  } catch (err) {
    status(`Could not open that file: ${(err as Error).message}`, 'error');
  }
}

/**
 * Write the document out as .maxpat.
 *
 * `reuse` is the difference between Save and Save As: with a handle in hand the File
 * System Access API writes straight back to the file that was opened, which is the whole
 * point of keeping it. ui/file-io.ts falls back to a download where that API is missing,
 * and reports that by returning no handle — so `fileHandle` is assigned from the result
 * either way and the next ⌘S asks again rather than silently re-downloading.
 */
async function writeFile(reuse: boolean): Promise<void> {
  if (!doc) return;
  try {
    fileHandle = await saveMaxpat(
      patchToMaxPat(doc, { renumber: true }),
      fileName(),
      reuse ? fileHandle : undefined
    );
    // A Save As can rename the document; the handle is the only place that shows up.
    if (fileHandle?.name) currentName = fileHandle.name;
    status(`Saved ${fileName()}`, 'ok');
  } catch (err) {
    // A dismissed picker is an answer, not a failure — announcing "Saved" or "Could not
    // save" over a dialog the user just cancelled is the reason this is its own type.
    if (err instanceof PickerCancelled) return;
    status(`Could not save: ${(err as Error).message}`, 'error');
  }
}

const save = (): void => void writeFile(true);
const saveAs = (): void => void writeFile(false);

/**
 * Copy a link that carries the whole patch in its fragment.
 *
 * Two try blocks, because they fail for unrelated reasons and deserve unrelated answers:
 * the patch can be too big to put in a URL at all, or the clipboard can be refused (no
 * user gesture, no permission, an insecure origin). The second is recoverable — the link
 * goes into the address bar instead, where the user can copy it themselves.
 */
async function share(): Promise<void> {
  if (!doc) return;
  // Share is a toggle for its popover: a second click closes it.
  if (closeSharePopover()) return;
  let link: Permalink;
  try {
    link = await buildPermalink(patchToMaxPat(doc, { renumber: true }));
  } catch (err) {
    if (err instanceof PermalinkTooLargeError) {
      status(err.message, 'error');
      return;
    }
    status(`Could not make a link: ${(err as Error).message}`, 'error');
    return;
  }
  // Copied first, then the popover: the common case is "click Share, paste somewhere",
  // and that must not wait on anything the popover offers. A refused clipboard is not
  // an error any more — the popover shows the link, selected, to copy by hand.
  let copied = true;
  try {
    await navigator.clipboard.writeText(link.url);
  } catch {
    copied = false;
  }
  status(copied ? 'Link copied' : 'Link ready — copy it from the Share box', 'ok');
  openSharePopover(shareBtn, {
    url: link.url,
    title: currentName.replace(/\.(maxpat|json)$/i, ''),
    copied,
    note: link.tooLong
      ? `This link is ${link.bytes.toLocaleString()} characters — long enough that some apps may cut it off.`
      : undefined,
  });
}

/**
 * Prove the patch makes a sound, without anyone having to listen to it.
 *
 * engine/selftest.ts renders the document through an OfflineAudioContext and measures
 * the result, so "does this work?" is an assertion rather than an opinion. The numbers
 * are also hung off `window.__selftest`, which is how an automated check reads them —
 * the one habit worth carrying over from the page this one replaced.
 */
async function selftest(): Promise<void> {
  if (!doc) return;
  selftestBtn.disabled = true;
  try {
    const result = await renderTone(patchToMaxPat(doc, { renumber: true }), 1);
    (window as unknown as { __selftest?: typeof result }).__selftest = result;
    status(
      `self-test: rms=${result.rms.toFixed(4)} dominant≈${result.dominantHz.toFixed(1)} Hz`,
      result.rms > 1e-4 ? 'ok' : 'info'
    );
  } catch (err) {
    status(`Self-test failed: ${(err as Error).message}`, 'error');
  } finally {
    selftestBtn.disabled = false;
  }
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
 * The name the generated MaxPy saves under, and therefore the name a ▶ Run's document
 * carries. Fixed rather than derived from currentName: it is written into the script as
 * `patch.save("…")`, and a filename that changed out from under a script the user may
 * have detached and edited would be a surprising edit to their text.
 */
const PY_FILENAME = 'my_patch.maxpat';

/** The fragment studio.html redirects to, so the old Studio URL still opens Python. */
const PYTHON_HASH = '#python';

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

/** How long ago the autosave slot was written, in words a person would use. */
function agoWords(since: number): string {
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (secs < 90) return 'a moment ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The restore notice.
 *
 * The patch is ALREADY on the canvas by the time this appears — restoring behind a
 * dialog would mean an empty page until the user answered a question about work they
 * may not remember doing. The bar only offers the way back out.
 */
function showRestoreBar(snapshot: { savedAt: number; name?: string }): void {
  restoreText.textContent = `Restored ${snapshot.name ?? 'your last patch'} · saved ${agoWords(
    snapshot.savedAt
  )}`;
  restoreBar.hidden = false;
}

/**
 * Startup precedence: `#p=` permalink → `?patch=<sample>` → the autosave slot → the
 * bundled starter.
 *
 * The permalink goes first because it is the most specific thing anyone can hand you:
 * somebody sent this exact patch to this exact person. The autosave comes AFTER both
 * URL forms for the same reason in reverse — a link the user just clicked must not be
 * overruled by whatever they happened to be editing yesterday.
 */
async function boot(): Promise<void> {
  try {
    const shared = await readPermalinkFromLocation();
    if (shared) {
      await loadPatch(shared, 'Shared patch.maxpat');
      return;
    }
  } catch (err) {
    // A damaged `#p=` is worth saying out loud: the alternative is a user staring at the
    // starter patch wondering what happened to the link they were sent.
    status(`That shared link could not be read: ${(err as Error).message}`, 'error');
  }

  const param = new URLSearchParams(location.search).get('patch');
  if (param) {
    try {
      await loadUrl(sampleUrl(param), param);
      return;
    } catch (err) {
      status(`Could not load ?patch=${param}: ${(err as Error).message}`, 'error');
    }
  }

  const snapshot = loadAutosave();
  if (snapshot) {
    try {
      await loadPatch(snapshot.json, snapshot.name ?? 'Restored.maxpat');
      showRestoreBar(snapshot);
      return;
    } catch (err) {
      // A slot we cannot read is a slot worth dropping, or it greets the user again
      // tomorrow with the same failure.
      clearAutosave();
      status(`Could not restore your last patch: ${(err as Error).message}`, 'error');
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

selftestBtn.addEventListener('click', () => void selftest());

newBtn.addEventListener('click', () => void newPatch());
newFromClipboardBtn.addEventListener('click', () => void newFromClipboard());
openBtn.addEventListener('click', () => void openPatch());
saveBtn.addEventListener('click', save);
saveAsBtn.addEventListener('click', saveAs);
shareBtn.addEventListener('click', () => void share());

samplesSelect.addEventListener('change', () => {
  const path = samplesSelect.value;
  // Back to the prompt row immediately, so re-picking the sample you are already on
  // fires `change` again — otherwise the menu is a one-shot per patch.
  samplesSelect.selectedIndex = 0;
  if (!path) return;
  const name = path.split('/').pop() ?? path;
  void loadUrl(import.meta.env.BASE_URL + path, name).catch((err: Error) =>
    status(`Could not load ${name}: ${err.message}`, 'error')
  );
});

subpatchBackBtn.addEventListener('click', () => void back());
// Escape leaves a subpatcher from anywhere on the page that is not a text field — the
// canvas's own controller handles it first when it has focus (it may have a gesture to
// abandon instead), and marks the event handled when it went back.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || ownsKeyboard(e.target)) return;
  if (back()) e.preventDefault();
});

restoreFreshBtn.addEventListener('click', () => {
  clearAutosave();
  restoreBar.hidden = true;
  void newPatch();
});
restoreDismissBtn.addEventListener('click', () => {
  restoreBar.hidden = true;
});

// Drop is scoped to the canvas, not the document: the page has other drop targets (the
// palette drags out of, the drawer) and a document-level handler would swallow them.
// ui/file-io.ts decides what a drag is carrying from `dataTransfer.types` and claims
// only the kinds that have a handler here.
installCanvasDrop(canvasEl, {
  onFile: (file) => void openFile(file),
  onAudio: (files) => void addAudioFiles(files),
  onObject: (name, at) => placeObject(name, toPatch(at)),
  onFragment: (text, at) => {
    input?.insertFragment(text, toPatch(at));
  },
});

zoomInBtn.addEventListener('click', () => zoomBy(1.25));
zoomOutBtn.addEventListener('click', () => zoomBy(0.8));
zoomLevelBtn.addEventListener('click', () => zoomTo(1));
zoomFitBtn.addEventListener('click', zoomFit);
canvasEl.addEventListener('patcher:zoom', () => updateZoom());

paletteToggle.addEventListener('click', togglePalette);
inspectorPin.addEventListener('click', toggleInspector);
themeToggle.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
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
    k: openPaletteAndSearch,
    i: toggleInspector,
    // ⇧⌘S is Save As in every application that has both; without it, "save a copy" is
    // a trip to the toolbar in the middle of a keyboard-driven session.
    s: e.shiftKey ? saveAs : save,
    o: () => void openPatch(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Palette + inspector. Built once, here, because neither holds a document: they survive
// every New, Open and ▶ Run, and remounting them per document would throw away the
// user's search, their scroll position and their collapsed groups for no reason.
// ─────────────────────────────────────────────────────────────────────────────

palette = new Palette(el('palette-body'), {
  // A click with no point of its own goes to the middle of what the user is looking at.
  // `centre` (below) is what lets the palette cascade repeats from there itself.
  onPlace: (name, at) => placeObject(name, at ?? canvasCentre()),
  centre: canvasCentre,
});

inspector = new Inspector(el('inspector-body'), {
  // The inspector edits whatever the canvas is showing: inside an open subpatcher, the
  // selected box is one of ITS boxes, and the edit is written back from there.
  onEdit: (id, text) => here()?.doc.setBoxText(id, text),
  // The pane thinks in absolute positions and the document moves by deltas; nothing
  // else can move a box from a text field, so the translation lives here.
  onMove: (id, x, y) => {
    const target = here()?.doc;
    const node = target?.node(id);
    if (node) target?.moveNodes([id], x - node.rect[0], y - node.rect[1]);
  },
  onOpen: (id) => void openSubpatch(id),
  // onAlign is deliberately absent: there is no align command anywhere in the app yet,
  // and Inspector renders the six buttons only when it is given one — so the
  // multi-selection panel says what it can do instead of offering six dead buttons.
});

/**
 * ⌘K. OPEN first, then focus: a rail's pane-body is `display: none`, and focus() on
 * something in a hidden subtree does nothing at all — the order is the whole fix. The
 * focus is deferred a frame so it lands after the layout the class change causes.
 */
function openPaletteAndSearch(): void {
  if (narrow.matches) setOverlay('palette', true);
  else setPaletteOpen(true);
  requestAnimationFrame(() => palette?.focusSearch());
}

// ── restore the persisted layout, before the first paint of anything below ──
// The theme attribute is already on <html> — index.html's inline script stamped it before
// first paint. This only brings the toggle's own glyph and title into agreement with it,
// and must not persist: writing here would turn "never chose" into "chose light".
setTheme(currentTheme(), false);
setPaletteOpen(readPref('palette.open') !== 'false');
setInspectorPinned(readPref('inspector.pinned') !== 'false');
setDrawerHeight(Number(readPref('drawer.height')) || DRAWER_DEFAULT, false);
// `#python` is studio.html's redirect target: that URL promised a Python editor, so it
// still opens one. It is the only fragment that opens the drawer — and it is checked
// before boot() reads `#p=`, which is a different key in the same namespace.
setDrawerOpen(location.hash === PYTHON_HASH || readPref('drawer.open') === 'true');
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
  get viewDoc() {
    return here()?.doc ?? null;
  },
  get subpatchPath() {
    return levels.slice(1).map((l) => l.boxId ?? '');
  },
  openSubpatch,
  back,
  get engine() {
    return engine;
  },
  get view() {
    return view;
  },
  get input() {
    return input;
  },
  get python() {
    return pane;
  },
  get sync() {
    return sync;
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
      widgetFor: (id) => builtHere().get(id)?.el,
      // The inspector is a view of the selection, and the selection lives in the
      // renderer. This is the only place it changes without a document transaction —
      // clicking a box edits nothing — so it is the only place that can say so.
      onSelectionChange: showSelection,
    })
);
