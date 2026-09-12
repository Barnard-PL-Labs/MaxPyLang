// Gestures: the layer that turns pointer and key events into document edits.
//
// This is the milestone the rest of the patcher was built to support. Everything below
// it — the ops document, the incremental renderer, the incremental engine — exists so
// that the two most frequent gestures in Max, dragging a box and drawing a cord, cost
// one transform write and one Web Audio connect() respectively, rather than a rebuild.
// The single easiest way to throw all of that away is to re-render or re-build from in
// here, so this file never touches the DOM of a box and never touches the engine. It
// calls PatchDoc, and the document's op feed does the rest.
//
// FOUR RULES, and every one of them is load-bearing:
//
//   1. HIT TESTING IS DOM DELEGATION, never geometry. `e.target.closest('[data-port]')`,
//      then `[data-box]`, then `[data-edge]`, else background. The browser already did
//      the hit test, under the pan/zoom transform, through the <foreignObject> of a
//      mounted widget, against the CSS that decides which layer is pointer-transparent
//      in which mode. Re-deriving it from coordinates would be a second, worse copy of
//      all of that — and would silently disagree with it the moment a stylesheet moved
//      a port by a pixel. The one place coordinates are used is the cord SNAP, where
//      the question is genuinely "what is near here", and even that goes through the
//      renderer's hitPort(), which probes with elementFromPoint.
//
//   2. A DRAG IS ONE UNDO ENTRY. doc.moveNodes(ids, dx, dy, /*coalesce*/ true) folds
//      every frame of a gesture into the entry the first frame opened. See the note on
//      `endGestureCoalesce` for the one seam this needs from PatchDoc.
//
//   3. MODE IS A LOCK, NOT A BRANCH. In run mode this controller simply does not start
//      an editing gesture; it does not try to decide whether a particular pointerdown
//      "was meant for" the widget. Whether the pointer reaches a mounted slider at all
//      is settled by `pointer-events` on its <foreignObject>, written by the renderer
//      and by ui/patcher.css. That is why dragging a box with a slider in it works: the
//      slider never sees the event, so there is nothing to arbitrate.
//
//   4. NOTHING HERE IS ASYNC ACROSS A GESTURE. A gesture is a synchronous state machine
//      between pointerdown and pointerup; the only asynchrony is the box editor, which
//      is modal with respect to the keyboard and is checked for at the top of every
//      handler.
//
// ── the UI-box text problem, stated once ────────────────────────────────────────────
// PatchDoc.setBoxText() resolves its argument with resolveBox(), which reads the first
// token as a class name. A `message` box's own `text` is its CONTENTS with no class
// prefix (`1 2`), so feeding that back would resolve class "1" and corrupt the box. So
// this file keeps three views of one box's text — what the document stores (`text`),
// what resolveBox can read (`sourceText`), and what the user should see and type
// (`editableText`) — and converts between them at the editor boundary. The alternative
// is a `setBoxContent()` on the document; see the note in this task's report.

import type { PatchDoc } from '../doc/patch-doc';
import type { MaxNode } from '../engine/registry';
import { canConnect, loadObjDocs, type Verdict } from '../ir/connect';
import type { Domain, IRNode } from '../ir/types';
import { nodeToBox } from '../parser/write-maxpat';
import { openBoxEditor, type BoxEditorHandle } from './box-editor';
import type { Point } from './layout';
import type { PatcherMode, PatcherView, PortHit } from './patcher';

/** Max's own patching grid. Held down ⌥ frees it, as it does in Max. */
const GRID = 8;
/** Screen-pixel radius a cord end snaps to an inlet from. Measured on screen, so the
 *  gesture feels identical at every zoom. */
const SNAP_PX = 18;
/** Screen pixels of travel before a press becomes a drag rather than a click. */
const SLOP = 3;
const NUDGE = 1;
const NUDGE_BIG = 10;
/** Where a paste or a ⌘D lands relative to its source, so the copy is visibly a copy. */
const CLONE_OFFSET = 24;
const ZOOM_STEP = 0.002;

const ERR_COLOR = '#e8736b';

/** The single-letter box shortcuts. '' is an empty object box you then type into. */
const NEW_BOX: Readonly<Record<string, string>> = {
  n: '',
  m: 'message',
  i: 'number',
  f: 'flonum',
  t: 'toggle',
  b: 'button',
  c: 'comment',
};

export interface InteractionHost {
  doc: PatchDoc;
  view: PatcherView;
  /** One-line user-facing messages: a refused cord, a cord orphaned by a retype. */
  onStatus?(msg: string): void;
  /**
   * The engine's live node map, if the patch has been built. Optional, and it only ever
   * sharpens canConnect()'s verdict — see ir/connect.ts. A function rather than a value
   * because Engine.build() replaces nothing but fills the same Map, and a controller
   * that captured it once would still be right; a controller handed a NEW map on the
   * next build would not be.
   */
  built?(): Map<string, MaxNode> | undefined;
}

type Geom = { x: number; y: number; w: number; h: number };

type Gesture =
  | null
  | {
      kind: 'cord';
      from: PortHit;
      anchor: Point;
      snap?: PortHit;
      verdict?: Verdict;
    }
  | {
      kind: 'drag';
      ids: string[];
      /** Patch point the press landed on, and the pressed box's origin at that moment. */
      start: Point;
      anchor: Point;
      /** Total delta already handed to the document, so each frame applies the rest. */
      dx: number;
      dy: number;
      moved: boolean;
      /** ⌥ at pointerdown: this gesture drags a COPY. Decided once, not per frame. */
      clone: boolean;
      cloned: boolean;
      /** Set when the press landed on an already-selected box; applied on a click. */
      pending?: { id: string; shift: boolean };
    }
  | { kind: 'marquee'; start: Point; cur: Point; additive: boolean }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number };

const snapTo = (v: number) => Math.round(v / GRID) * GRID;

function intersects(a: Geom, b: Geom): boolean {
  // Intersect, not contain: Max selects everything a marquee touches, and a patch is
  // usually laid out tightly enough that "fully inside" selects nothing useful.
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

/** The first whitespace-delimited token, or ''. */
const head = (s: string) => (s.match(/^\S+/) ?? [''])[0];

/**
 * Text that resolveBox() can read back into this box.
 *
 * For a `newobj` the stored text already names the class. For a UI box it may or may
 * not: Max writes a message box's contents alone, maxpylang writes the class name in
 * front of them, and both shapes reach the document through the parser.
 */
function sourceText(node: IRNode): string {
  const text = node.text.trim();
  if (node.maxclass === 'newobj') return text;
  return head(text) === node.className ? text : `${node.className} ${text}`.trim();
}

/** The half of a box's text the user typed and should see again. */
function editableText(node: IRNode): string {
  const text = node.text.trim();
  if (node.maxclass === 'newobj') return text;
  const first = head(text);
  return first === node.className ? text.slice(first.length).trim() : text;
}

/** The inverse of editableText: what the document should store for this typed line. */
function storedText(node: IRNode, typed: string): string {
  const text = typed.trim();
  if (node.maxclass === 'newobj') return text;
  return `${node.className} ${text}`.trim();
}

/** Same rule as sourceText, applied to a raw .maxpat box dict (paste). */
function boxSourceText(box: Record<string, unknown>): string {
  const maxclass = typeof box.maxclass === 'string' ? box.maxclass : 'newobj';
  const text = typeof box.text === 'string' ? box.text.trim() : '';
  if (maxclass === 'newobj') return text;
  return head(text) === maxclass ? text : `${maxclass} ${text}`.trim();
}

interface Fragment {
  boxes: { box: Record<string, unknown> }[];
  lines: { patchline: Record<string, unknown> }[];
}

/**
 * Read a pasted fragment.
 *
 * NOT VERIFIED AGAINST A REAL MAX COPY. Max's own clipboard payload has not been
 * inspected, so this accepts the shape this file WRITES ({boxes, lines}) and the shape
 * a .maxpat file has ({patcher: {boxes, lines}}) and claims nothing beyond that. If it
 * turns out Max writes something else, this is the one function that has to change.
 */
function readFragment(text: string): Fragment | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const root = (json as { patcher?: unknown })?.patcher ?? json;
  const boxes = (root as { boxes?: unknown })?.boxes;
  if (!Array.isArray(boxes)) return undefined;
  const lines = (root as { lines?: unknown })?.lines;
  const isDict = (v: unknown): boolean => typeof v === 'object' && v !== null;
  return {
    boxes: boxes.filter((b) => isDict(b) && isDict((b as { box?: unknown }).box)),
    lines: (Array.isArray(lines) ? lines : []).filter(
      (l) => isDict(l) && isDict((l as { patchline?: unknown }).patchline)
    ),
  } as Fragment;
}

/**
 * End the run of coalescing moves a drag opened, so the NEXT drag of the same boxes is
 * its own undo entry.
 *
 * Every frame of a drag passes `coalesce: true` — the first included, because commit()
 * only records the coalesce key on a call that requested one, so a first frame passing
 * `false` would split the gesture into two undo entries. That leaves nothing to CLOSE
 * the run, which is what PatchDoc.endCoalesce() is for. Called optionally so this file
 * still works against a document that predates it (the only symptom there is that two
 * drags of the same selection collapse into one ⌘Z).
 */
function endGestureCoalesce(doc: PatchDoc): void {
  (doc as Partial<{ endCoalesce(): void }>).endCoalesce?.();
}

/** Inputs the user TYPES into. A range, checkbox or button is a control, not a field. */
const NON_TEXT_INPUTS = new Set([
  'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image',
]);

/**
 * Does this event target own the keyboard?
 *
 * Exported because the app shell asks the same question of the same events and getting
 * a DIFFERENT answer there would be a bug on its own. The distinction that matters is
 * text entry, not the tag: a mounted `slider` is an `<input type=range>`, and treating
 * it as a text field made ⌘E stop working the moment you touched a widget in run mode —
 * which is precisely when you want to unlock the patch again.
 */
export function ownsKeyboard(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== 'string') return false;
  if (node.isContentEditable) return true;
  if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return true;
  return (
    node.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((node as HTMLInputElement).type)
  );
}

export class Interaction {
  private readonly doc: PatchDoc;
  private readonly view: PatcherView;
  private readonly host: InteractionHost;
  private readonly svg: SVGSVGElement;

  private g: Gesture = null;
  private editor: BoxEditorHandle | null = null;
  /** Space-to-pan: held state, because a keydown repeat must not restart the gesture. */
  private space = false;
  /** Last pointer position in patch coordinates — where a keyboard-made box goes. */
  private at: Point | null = null;
  /** In-session clipboard, so ⌘V works where navigator.clipboard is unreadable. */
  private stash = '';
  private destroyed = false;

  constructor(host: InteractionHost) {
    this.host = host;
    this.doc = host.doc;
    this.view = host.view;
    this.svg = host.view.svg;

    // Inlet domains come from a ~382 KB generated file the player must never load, so
    // it is pulled in here, once, at the moment the patcher gains the ability to draw a
    // cord. canConnect() judges (a little more loosely) without it; see ir/connect.ts.
    void loadObjDocs().catch(() => {
      /* offline, or the chunk failed: cord validation is simply less strict */
    });

    this.svg.addEventListener('pointerdown', this.onPointerDown);
    this.svg.addEventListener('pointermove', this.onPointerMove);
    this.svg.addEventListener('pointerup', this.onPointerUp);
    this.svg.addEventListener('pointercancel', this.onPointerCancel);
    this.svg.addEventListener('dblclick', this.onDblClick);
    this.svg.addEventListener('keydown', this.onKeyDown);
    this.svg.addEventListener('keyup', this.onKeyUp);
    // Not passive: a wheel over the canvas pans or zooms the patch and must not also
    // scroll the page, and preventDefault is unavailable on a passive listener.
    this.svg.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /**
   * The lock, READ THROUGH THE RENDERER rather than mirrored here.
   *
   * The app shell also drives mode (its buttons call view.setMode directly), so a
   * private copy in this class would go stale the first time the user clicked the
   * segmented control instead of pressing ⌘E — and then ⌘E would toggle from the wrong
   * value. One source of truth makes that unrepresentable.
   */
  get mode(): PatcherMode {
    return this.view.mode;
  }

  /** Switch the lock, cancelling anything in flight. Idempotent. */
  setMode(m: PatcherMode): void {
    if (m === this.view.mode) return;
    this.abort();
    this.view.setMode(m);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.editor?.close();
    this.editor = null;
    this.g = null;
    this.view.setOverlay(null);
    this.svg.removeEventListener('pointerdown', this.onPointerDown);
    this.svg.removeEventListener('pointermove', this.onPointerMove);
    this.svg.removeEventListener('pointerup', this.onPointerUp);
    this.svg.removeEventListener('pointercancel', this.onPointerCancel);
    this.svg.removeEventListener('dblclick', this.onDblClick);
    this.svg.removeEventListener('keydown', this.onKeyDown);
    this.svg.removeEventListener('keyup', this.onKeyUp);
    this.svg.removeEventListener('wheel', this.onWheel);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // pointer
  // ───────────────────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (this.destroyed) return;
    this.at = this.view.clientToPatch(e);

    // An open editor owns the next click: clicking away commits, exactly as it does in
    // Max. Committed explicitly rather than by letting the focus move do it, because
    // `blur` only fires if the input was focused, and a canvas embedded in a page that
    // never gave it focus would strand the editor open. The click is spent dismissing
    // the editor rather than also landing — the commit can delete or resize the very
    // box the click was aimed at.
    if (this.editor) {
      const editor = this.editor;
      this.svg.focus();
      editor.commit();
      return;
    }

    const target = e.target as Element | null;
    const onBox = target?.closest('[data-box]') ?? null;
    const onCord = target?.closest('[data-edge]') ?? null;

    // Pan: middle button anywhere, space-drag anywhere, or a plain drag of the
    // background while the patch is locked (Max's hand cursor).
    if (e.button === 1 || (e.button === 0 && this.space) ||
        (e.button === 0 && this.mode === 'run' && !onBox && !onCord)) {
      this.beginPan(e);
      return;
    }
    if (e.button !== 0 || this.mode !== 'edit') return;

    e.preventDefault();
    this.svg.focus();

    const port = target?.closest('[data-port]');
    if (port) {
      this.beginCord(port, e);
      return;
    }
    if (onBox) {
      const id = onBox.getAttribute('data-box');
      if (id) this.beginBoxGesture(id, e);
      return;
    }
    if (onCord) {
      const key = onCord.getAttribute('data-edge');
      if (key) this.view.selectEdges([key], e.shiftKey);
      return;
    }
    this.beginMarquee(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed) return;
    this.at = this.view.clientToPatch(e);
    const g = this.g;
    if (!g) return;
    switch (g.kind) {
      case 'cord':
        this.moveCord(g, e);
        return;
      case 'drag':
        this.moveDrag(g, e);
        return;
      case 'marquee':
        g.cur = this.at;
        this.view.setOverlay({
          kind: 'marquee',
          x: g.start.x,
          y: g.start.y,
          w: g.cur.x - g.start.x,
          h: g.cur.y - g.start.y,
        });
        return;
      case 'pan':
        this.view.setViewport({
          x: g.vx + (e.clientX - g.sx),
          y: g.vy + (e.clientY - g.sy),
          zoom: this.view.viewport.zoom,
        });
        return;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.destroyed) return;
    const g = this.g;
    this.g = null;
    this.release(e);
    if (!g) return;
    switch (g.kind) {
      case 'cord':
        this.finishCord(g, e);
        return;
      case 'drag':
        this.finishDrag(g);
        return;
      case 'marquee':
        this.finishMarquee(g);
        return;
      case 'pan':
        this.emitZoom();
        return;
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.release(e);
    this.abort();
  };

  private capture(e: PointerEvent): void {
    // A synthetic PointerEvent has no active pointer behind it, so setPointerCapture
    // throws NotFoundError — and a real one can be gone by the time we ask. Capture is
    // an optimization (it keeps pointermove coming when the cursor leaves the canvas),
    // never a precondition, so failing to get it is not an error.
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* no capture: moves still arrive while the pointer is over the canvas */
    }
  }

  private release(e: PointerEvent): void {
    try {
      if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    } catch {
      /* never had it */
    }
  }

  /** Drop whatever gesture is in flight, leaving the document as it was. */
  private abort(): void {
    const g = this.g;
    this.g = null;
    this.view.setOverlay(null);
    if (g?.kind === 'drag' && (g.dx !== 0 || g.dy !== 0)) {
      this.doc.moveNodes(g.ids, -g.dx, -g.dy, true);
      endGestureCoalesce(this.doc);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // cords
  // ───────────────────────────────────────────────────────────────────────────

  private beginCord(port: Element, e: PointerEvent): void {
    const id = port.getAttribute('data-box');
    const dir = port.getAttribute('data-dir');
    const index = Number(port.getAttribute('data-index'));
    if (!id || (dir !== 'in' && dir !== 'out') || !Number.isInteger(index)) return;
    const anchor = this.view.portPoint(id, dir, index);
    if (!anchor) return;
    this.g = { kind: 'cord', from: { id, dir, index }, anchor };
    this.capture(e);
    this.drawCord(anchor, anchor, this.domainOf({ id, dir, index }), undefined);
  }

  private moveCord(g: Extract<Gesture, { kind: 'cord' }>, e: PointerEvent): void {
    const loose = this.view.clientToPatch(e);
    const snap = this.cordTarget(g, e);
    g.snap = snap;
    g.verdict = snap ? this.judge(g.from, snap) : undefined;

    const end = snap ? (this.view.portPoint(snap.id, snap.dir, snap.index) ?? loose) : loose;
    const source = g.from.dir === 'out' ? g.from : snap;
    // Always drawn outlet -> inlet, whichever end the drag started from: cordPath()'s
    // control points leave downward and arrive upward, so a cord drawn backwards reads
    // as an S-bend that no committed cord will ever look like.
    const a = g.from.dir === 'out' ? g.anchor : end;
    const b = g.from.dir === 'out' ? end : g.anchor;
    this.drawCord(a, b, source ? this.domainOf(source) : undefined, g.verdict);
  }

  /**
   * Where this cord would land if it were released here.
   *
   * Two rules, and the second is the one Max users have in their hands:
   *   • a port nub within SNAP_PX, facing the other way — `want` is passed down so the
   *     search cannot stop on a same-direction port and report nothing;
   *   • failing that, ANY PART OF A BOX is a drop target and the nearest facing port of
   *     that box wins. Without this the only place a cord could be dropped was the
   *     16x10px nub: on `unpack 1 2 3` the entire box was dead, and on a `*~ 0.2` an
   *     18px band in the middle was, with no cord, no new box, and no message to say so.
   *
   * The box the cord STARTED from is excluded, so releasing back where you began
   * cancels the gesture rather than wiring an object to itself by accident.
   */
  private cordTarget(
    g: Extract<Gesture, { kind: 'cord' }>,
    e: PointerEvent,
  ): PortHit | undefined {
    const want = g.from.dir === 'out' ? 'in' : 'out';
    const near = this.view.hitPort(e.clientX, e.clientY, SNAP_PX, want);
    if (near && near.id !== g.from.id) return near;
    const box = this.view.hitBox(e.clientX, e.clientY);
    if (!box || box === g.from.id) return undefined;
    return this.view.nearestPort(box, want, e.clientX);
  }

  private finishCord(g: Extract<Gesture, { kind: 'cord' }>, e: PointerEvent): void {
    this.view.setOverlay(null);
    const { snap, verdict } = g;
    if (snap && verdict) {
      if (!verdict.ok) {
        this.status(verdict.reason);
        return;
      }
      const ends = orient(g.from, snap);
      if (this.doc.addEdge(ends.from, ends.to) && 'warn' in verdict) this.status(verdict.warn);
      return;
    }
    // Released over the page chrome — the palette rail, the inspector, a toolbar button,
    // the status bar. clientToPatch() happily projects those to a patch coordinate, so
    // without this guard a cord dragged out of the canvas minted a box at a point the
    // user could not see (often negative) with its editor open on top of the chrome. In
    // Max, dragging a cord out of the patcher and letting go does nothing.
    if (!this.view.contains(e.clientX, e.clientY)) return;
    // Dropped on nothing: Max's most-used move is "drag out of an outlet and type the
    // next object", so the drop point becomes a new box that is already wired. A drop on
    // a BOX that offered no facing port (the source box itself, or a sink with no
    // outlets) is a cancelled gesture, not a place to put a new box.
    if (this.view.hitBox(e.clientX, e.clientY)) return;
    this.newBoxAt(this.view.clientToPatch(e), '', g.from);
  }

  private judge(a: PortHit, b: PortHit): Verdict {
    const ends = orient(a, b);
    return canConnect(this.doc, ends.from, ends.to, this.host.built?.());
  }

  private domainOf(port: PortHit): Domain | undefined {
    if (port.dir !== 'out') return undefined;
    return this.doc.node(port.id)?.outletDomains[port.index];
  }

  /**
   * Paint the rubber cord for the three states.
   *
   * PatcherView.setOverlay models one boolean (`invalid`), which is the dashed
   * treatment both a WARN and a REFUSE want; the colour that separates them is applied
   * here, straight onto the element the renderer just created. Reaching for it by class
   * rather than asking the renderer for a richer Overlay type keeps ui/patcher.ts
   * untouched — see the report note for the two-line widening that would make this
   * unnecessary.
   */
  private drawCord(from: Point, to: Point, domain: Domain | undefined, verdict?: Verdict): void {
    const refused = verdict !== undefined && !verdict.ok;
    const warned = verdict !== undefined && verdict.ok && 'warn' in verdict;
    this.view.setOverlay({ kind: 'cord', from, to, domain, invalid: refused || warned });
    const path = this.svg.querySelector<SVGPathElement>('.overlay-cord');
    if (!path) return;
    path.classList.toggle('refused', refused);
    path.classList.toggle('warn', warned);
    if (refused) path.setAttribute('stroke', ERR_COLOR);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // boxes: select, drag, duplicate
  // ───────────────────────────────────────────────────────────────────────────

  private beginBoxGesture(id: string, e: PointerEvent): void {
    let pending: { id: string; shift: boolean } | undefined;
    if (this.view.selection.has(id)) {
      // Already selected: drag the WHOLE selection, and defer "select only this" to
      // pointerup. Reselecting on the way down would break dragging a multi-selection,
      // which is the thing multi-select is for.
      pending = { id, shift: e.shiftKey };
    } else {
      this.view.select([id], e.shiftKey);
    }

    const ids = [...this.view.selection];
    const anchorNode = this.doc.node(id);
    if (ids.length === 0 || !anchorNode) return;
    this.g = {
      kind: 'drag',
      ids,
      start: this.view.clientToPatch(e),
      anchor: { x: anchorNode.rect[0], y: anchorNode.rect[1] },
      dx: 0,
      dy: 0,
      moved: false,
      clone: e.altKey,
      cloned: false,
      pending,
    };
    this.capture(e);
  }

  private moveDrag(g: Extract<Gesture, { kind: 'drag' }>, e: PointerEvent): void {
    const p = this.view.clientToPatch(e);
    const rawX = p.x - g.start.x;
    const rawY = p.y - g.start.y;
    const zoom = this.view.viewport.zoom;
    if (!g.moved && Math.hypot(rawX * zoom, rawY * zoom) < SLOP) return;
    g.moved = true;

    if (g.clone && !g.cloned) {
      g.cloned = true;
      // ⌥-drag duplicates in place and then drags the copies, so the originals stay put
      // and the gesture the user started continues uninterrupted.
      const map = this.duplicate(g.ids, 0, 0);
      if (map.size > 0) {
        g.ids = g.ids.map((id) => map.get(id) ?? id);
        this.view.select(g.ids);
        // duplicate() committed a transaction of its own, and any commit closes the
        // run of coalescing moves. Re-open it for the copies, so the frames that follow
        // fold into the Duplicate entry instead of pushing a second one: an Option-drag
        // is one action in Max, and the first Cmd-Z has to remove the copy rather than
        // park it pixel-exactly on top of the original.
        this.doc.beginCoalesce(g.ids);
      }
    }

    // Snap the ANCHOR box to the grid and move everything by the same delta, so the
    // relative layout of a multi-selection survives a snapped drag intact.
    let tx = g.anchor.x + rawX;
    let ty = g.anchor.y + rawY;
    if (!e.altKey) {
      tx = snapTo(tx);
      ty = snapTo(ty);
    }
    const dx = tx - g.anchor.x - g.dx;
    const dy = ty - g.anchor.y - g.dy;
    if (dx === 0 && dy === 0) return;
    // coalesce on EVERY frame, the first included — see endGestureCoalesce.
    this.doc.moveNodes(g.ids, dx, dy, true);
    g.dx += dx;
    g.dy += dy;
  }

  private finishDrag(g: Extract<Gesture, { kind: 'drag' }>): void {
    if (g.moved) {
      endGestureCoalesce(this.doc);
      return;
    }
    const pending = g.pending;
    if (!pending) return;
    if (pending.shift) {
      const next = new Set(this.view.selection);
      next.delete(pending.id);
      this.view.select(next);
    } else {
      this.view.select([pending.id]);
    }
  }

  private beginMarquee(e: PointerEvent): void {
    if (!e.shiftKey) this.view.select([]);
    const start = this.view.clientToPatch(e);
    this.g = { kind: 'marquee', start, cur: start, additive: e.shiftKey };
    this.capture(e);
  }

  private finishMarquee(g: Extract<Gesture, { kind: 'marquee' }>): void {
    this.view.setOverlay(null);
    const rect: Geom = {
      x: Math.min(g.start.x, g.cur.x),
      y: Math.min(g.start.y, g.cur.y),
      w: Math.abs(g.cur.x - g.start.x),
      h: Math.abs(g.cur.y - g.start.y),
    };
    if (rect.w < 1 && rect.h < 1) return; // a click, not a sweep
    const hits: string[] = [];
    for (const node of this.doc.nodes()) {
      const geom = this.geomOf(node.id);
      if (geom && intersects(geom, rect)) hits.push(node.id);
    }
    this.view.select(hits, g.additive);
  }

  private beginPan(e: PointerEvent): void {
    e.preventDefault();
    const vp = this.view.viewport;
    this.g = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
    this.capture(e);
  }

  /** A box's rendered rect, falling back to its authored one before the first paint. */
  private geomOf(id: string): Geom | undefined {
    const geom = this.view.boxGeom(id);
    if (geom) return geom;
    const node = this.doc.node(id);
    return node ? { x: node.rect[0], y: node.rect[1], w: node.rect[2], h: node.rect[3] } : undefined;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // the box editor
  // ───────────────────────────────────────────────────────────────────────────

  private onDblClick = (e: MouseEvent): void => {
    if (this.destroyed || this.mode !== 'edit' || this.editor) return;
    e.preventDefault();
    const target = e.target as Element | null;
    const id = target?.closest('[data-box]')?.getAttribute('data-box');
    if (id && this.doc.node(id)) {
      this.editBox(id);
      return;
    }
    // A cord is not empty canvas. `.cord-hit` carries data-edge, not data-box, so a
    // double-click that landed exactly on a patch cord used to fall through to "make a
    // box here" — a phantom empty box on top of the cord, from a gesture that in Max
    // does nothing. Select it instead, which is what a single click already does.
    const key = target?.closest('[data-edge]')?.getAttribute('data-edge');
    if (key) {
      this.view.selectEdges([key], e.shiftKey);
      return;
    }
    this.newBoxAt(this.view.clientToPatch(e), '');
  };

  /**
   * Create a box and open its editor, optionally pre-wired to the port a cord was
   * dragged from.
   *
   * The box exists from the first keystroke rather than being materialized on commit,
   * because that is what Max shows and because the editor needs a rectangle to sit on.
   * An empty commit (or Escape) on a box whose text is still empty removes it again.
   */
  private newBoxAt(at: Point, initial: string, wire?: PortHit): void {
    const node = this.doc.addBox(initial, snapTo(at.x), snapTo(at.y));
    this.view.select([node.id]);
    this.openEditor(node, true, wire);
  }

  private editBox(id: string): void {
    const node = this.doc.node(id);
    if (!node) return;
    this.view.select([id]);
    this.openEditor(node, false);
  }

  private openEditor(node: IRNode, fresh: boolean, wire?: PortHit): void {
    const geom = this.geomOf(node.id);
    if (!geom) return;
    const vp = this.view.viewport;
    const id = node.id;
    // The document revision the box was created at, for the two undo-stack repairs
    // below. Both are only safe while the add is still the top entry — an editor is
    // modal with respect to this controller, but the document is shared with the app
    // shell (Open, New, the Python drawer), so the guard is a real one.
    const bornRev = fresh ? this.doc.revision : undefined;
    const ownsTopEntry = () => bornRev !== undefined && this.doc.revision === bornRev;

    this.editor = openBoxEditor({
      // The <svg> root, not the renderer's overlay layer: setOverlay() replaceChildren()s
      // that layer on every pointermove, which would delete the editor mid-gesture. The
      // root carries no transform, so the geometry is converted here and the typography
      // is scaled by hand.
      layer: this.svg,
      geom: {
        x: vp.x + geom.x * vp.zoom,
        y: vp.y + geom.y * vp.zoom,
        w: geom.w * vp.zoom,
        h: geom.h * vp.zoom,
        scale: vp.zoom,
      },
      initial: editableText(node),
      onCommit: (typed) => {
        this.editor = null;
        this.commitBox(id, typed, fresh, wire, ownsTopEntry());
      },
      onCancel: () => {
        this.editor = null;
        const live = this.doc.node(id);
        // Escape on a box that never got a name removes it; on one created by a
        // shortcut (a toggle, an empty message) there is nothing to undo.
        if (fresh && live && sourceText(live) === '') this.discardFresh(id, ownsTopEntry());
      },
    });
  }

  /**
   * Take back the empty box a cancelled (or empty-committed) creation left behind.
   *
   * Rolled off the undo stack rather than deleted when this controller still owns the
   * top entry: a create-then-delete pair leaves TWO entries, so the next Cmd-Z
   * resurrects a phantom empty box instead of reaching the user's last real edit. If
   * anything else has touched the document since, fall back to an ordinary delete —
   * reversing somebody else's edit would be far worse than an extra undo step.
   */
  private discardFresh(id: string, ownsTopEntry: boolean): void {
    if (ownsTopEntry && this.doc.rollbackLast()) return;
    this.doc.removeNodes([id]);
  }

  private commitBox(
    id: string,
    typed: string,
    fresh: boolean,
    wire: PortHit | undefined,
    ownsTopEntry: boolean,
  ): void {
    const node = this.doc.node(id);
    if (!node) return;
    const text = storedText(node, typed);
    if (text === '') {
      // Max deletes a brand-new box you commit empty. An EXISTING box is left alone —
      // silently emptying somebody's `cycle~ 440` because they cleared the field and
      // clicked away would be data loss, not an edit.
      if (fresh) this.discardFresh(id, ownsTopEntry);
      return;
    }
    const before = this.doc.edgesOf(id).length;
    // Making a box is ONE action: the empty box the editor sat on and the text that
    // named it fold into a single entry, so Cmd-Z after typing `cycle~ 440` removes the
    // box rather than emptying it.
    // Named from the text being committed, not from `node` — `node` is still the empty
    // box the editor opened on, so its className is ''. head() is the class for a newobj
    // and, via storedText, the class prefix of a UI box too.
    if (fresh && ownsTopEntry) this.doc.mergeNext(`New ${head(text) || 'object'}`);
    this.doc.transact(fresh ? 'New object' : 'Retype box', () => {
      this.doc.setBoxText(id, text);
      if (!wire) return;
      const fresher = this.doc.node(id);
      if (!fresher) return;
      const ends =
        wire.dir === 'out'
          ? { from: { id: wire.id, outlet: wire.index }, to: { id, inlet: 0 } }
          : { from: { id, outlet: 0 }, to: { id: wire.id, inlet: wire.index } };
      this.doc.addEdge(ends.from, ends.to);
    });
    const lost = before - this.doc.edgesOf(id).length + (wire ? 1 : 0);
    // The document already dropped the cords the new arity cannot carry. Doing it
    // silently is hostile: the patch stops working and nothing on screen said why.
    if (lost > 0) this.status(`${lost} cord${lost === 1 ? '' : 's'} removed — fewer inlets/outlets`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // keyboard
  // ───────────────────────────────────────────────────────────────────────────

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') this.space = false;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed || this.editor) return;
    if (ownsKeyboard(e.target)) return;

    const meta = e.metaKey || e.ctrlKey;
    if (meta) {
      const key = e.key.toLowerCase();
      if (this.commandKey(key, e.shiftKey)) {
        e.preventDefault();
        // ⌘E is the one command the app shell also binds, and it must reach it: the
        // shell owns the mode class on the canvas and the segmented control's pressed
        // state. Both handlers toggle, both end on the same value (the shell's call to
        // view.setMode is then a no-op), and the chrome stays honest. Everything else
        // is ours alone and is stopped so it cannot fire twice.
        if (key !== 'e') e.stopPropagation();
      }
      return;
    }
    if (e.key === ' ') {
      this.space = true;
      e.preventDefault();
      return;
    }
    if (this.mode !== 'edit') return;
    if (this.editKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private commandKey(key: string, shift: boolean): boolean {
    switch (key) {
      case 'z':
        if (shift) this.doc.redo();
        else this.doc.undo();
        return true;
      case 'y':
        this.doc.redo();
        return true;
      case 'e':
        this.setMode(this.mode === 'edit' ? 'run' : 'edit');
        return true;
      case 'a':
        if (this.mode !== 'edit') return false;
        this.view.select([...this.doc.nodes()].map((n) => n.id));
        return true;
      case 'c':
        if (this.mode !== 'edit') return false;
        this.copy([...this.view.selection]);
        return true;
      case 'x':
        if (this.mode !== 'edit') return false;
        this.copy([...this.view.selection]);
        this.deleteSelection();
        return true;
      case 'v':
        if (this.mode !== 'edit') return false;
        void this.pasteFromClipboard();
        return true;
      case 'd': {
        if (this.mode !== 'edit') return false;
        const map = this.duplicate([...this.view.selection], CLONE_OFFSET, CLONE_OFFSET);
        if (map.size > 0) this.view.select([...map.values()]);
        return true;
      }
      default:
        return false;
    }
  }

  private editKey(e: KeyboardEvent): boolean {
    const key = e.key;
    if (key === 'Escape') {
      this.abort();
      return true;
    }
    if (key === 'Backspace' || key === 'Delete') {
      this.deleteSelection();
      return true;
    }
    const step = e.shiftKey ? NUDGE_BIG : NUDGE;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[key];
    if (delta) {
      const ids = [...this.view.selection];
      if (ids.length === 0) return false;
      // Not coalesced: each press is a discrete edit, and merging a run of them would
      // make one ⌘Z jump the box an unpredictable distance.
      this.doc.moveNodes(ids, delta[0], delta[1], false);
      return true;
    }
    // Single-letter box shortcuts, only when no modifier is asking for something else.
    if (e.altKey || key.length !== 1) return false;
    const text = NEW_BOX[key.toLowerCase()];
    if (text === undefined) return false;
    const at = this.at ?? this.viewportCentre();
    const node = this.doc.addBox(text, snapTo(at.x), snapTo(at.y));
    this.view.select([node.id]);
    // An object box and a message box are containers for text you have not typed yet;
    // the other five are complete the moment they exist.
    if (key === 'n' || key === 'm') this.openEditor(node, true);
    return true;
  }

  private deleteSelection(): void {
    const edges = [...this.view.selectedEdges];
    if (edges.length > 0) {
      this.doc.transact(edges.length === 1 ? 'Disconnect' : `Disconnect ${edges.length} cords`, () => {
        for (const key of edges) this.doc.removeEdge(key);
      });
      return;
    }
    const ids = [...this.view.selection];
    if (ids.length > 0) this.doc.removeNodes(ids);
  }

  private viewportCentre(): Point {
    const box = this.svg.getBoundingClientRect();
    return this.view.clientToPatch({
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // clipboard
  // ───────────────────────────────────────────────────────────────────────────

  private copy(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const boxes: Fragment['boxes'] = [];
    for (const id of set) {
      const node = this.doc.node(id);
      if (node) boxes.push({ box: nodeToBox(node) });
    }
    const lines: Fragment['lines'] = [];
    for (const edge of this.doc.edges()) {
      if (!set.has(edge.from.id) || !set.has(edge.to.id)) continue;
      lines.push({
        patchline: {
          source: [edge.from.id, edge.from.outlet],
          destination: [edge.to.id, edge.to.inlet],
        },
      });
    }
    this.stash = JSON.stringify({ boxes, lines });
    // Best effort: the clipboard needs a permission this may not have, and a refusal
    // must not cost the user the copy — `stash` makes ⌘V work in-session regardless.
    void navigator.clipboard?.writeText(this.stash).catch(() => undefined);
    this.status(`Copied ${boxes.length} box${boxes.length === 1 ? '' : 'es'}`);
  }

  private async pasteFromClipboard(): Promise<void> {
    let text = '';
    try {
      text = (await navigator.clipboard?.readText()) ?? '';
    } catch {
      text = '';
    }
    if (this.destroyed) return;
    this.insertFragment(readFragment(text) ? text : this.stash);
  }

  /**
   * Insert patcher JSON — `{boxes, lines}` or a whole `{patcher: …}` file — as ONE
   * undoable edit, and select what it created.
   *
   * Public because ⌘V is not the only way a fragment arrives: ui/file-io.ts's canvas
   * drop handler reads the same payload off a DataTransfer and has nothing to call
   * otherwise. `at` is the patch point the fragment's top-left corner should land on,
   * which is what a drop means — it goes where the cursor is. Without it the fragment
   * keeps its authored coordinates stepped by CLONE_OFFSET, which is what a paste means:
   * the copy must be visibly not the original. Returns whether anything was inserted.
   */
  insertFragment(text: string, at?: Point): boolean {
    const frag = readFragment(text);
    if (!frag || frag.boxes.length === 0) {
      this.status(
        at
          ? 'Nothing in that drop this patcher can read.'
          : 'Nothing on the clipboard this patcher can read.'
      );
      return false;
    }
    const boxX = (box: Record<string, unknown>): number =>
      Number((Array.isArray(box.patching_rect) ? (box.patching_rect as number[])[0] : 0) ?? 0);
    const boxY = (box: Record<string, unknown>): number =>
      Number((Array.isArray(box.patching_rect) ? (box.patching_rect as number[])[1] : 0) ?? 0);
    // One offset for the whole fragment, computed from its top-left corner, so the boxes
    // keep their relative layout and the cursor lands on the corner of what was dropped.
    let dx = CLONE_OFFSET;
    let dy = CLONE_OFFSET;
    if (at) {
      const xs = frag.boxes.map((e) => boxX(e.box));
      const ys = frag.boxes.map((e) => boxY(e.box));
      dx = at.x - Math.min(...xs);
      dy = at.y - Math.min(...ys);
    }
    const map = new Map<string, string>();
    this.doc.transact(at ? 'Drop' : 'Paste', () => {
      for (const entry of frag.boxes) {
        const box = entry.box;
        const node = this.doc.addBox(boxSourceText(box), boxX(box) + dx, boxY(box) + dy);
        if (typeof box.id === 'string') map.set(box.id, node.id);
      }
      for (const entry of frag.lines) {
        const line = entry.patchline;
        const src = line.source as [string, number] | undefined;
        const dst = line.destination as [string, number] | undefined;
        if (!Array.isArray(src) || !Array.isArray(dst)) continue;
        const from = map.get(src[0]);
        const to = map.get(dst[0]);
        if (from && to) {
          this.doc.addEdge({ id: from, outlet: Number(src[1]) }, { id: to, inlet: Number(dst[1]) });
        }
      }
    });
    this.view.select([...map.values()]);
    return map.size > 0;
  }

  /**
   * Copy boxes (and the cords wholly inside the copied set) at an offset, as one edit.
   *
   * Cords are re-made through addEdge rather than copied, so a cord whose ports the new
   * box does not have simply never appears — the same rule setBoxText uses, and the
   * reason a duplicate of a mistyped box is never left holding an impossible cord.
   */
  private duplicate(ids: string[], dx: number, dy: number): Map<string, string> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const set = new Set(ids);
    const edges = [...this.doc.edges()].filter((e) => set.has(e.from.id) && set.has(e.to.id));
    this.doc.transact(ids.length === 1 ? 'Duplicate' : `Duplicate ${ids.length} boxes`, () => {
      for (const id of ids) {
        const node = this.doc.node(id);
        if (!node) continue;
        map.set(id, this.doc.addBox(sourceText(node), node.rect[0] + dx, node.rect[1] + dy).id);
      }
      for (const edge of edges) {
        const from = map.get(edge.from.id);
        const to = map.get(edge.to.id);
        if (from && to) {
          this.doc.addEdge({ id: from, outlet: edge.from.outlet }, { id: to, inlet: edge.to.inlet });
        }
      }
    });
    return map;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // viewport
  // ───────────────────────────────────────────────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    if (this.destroyed) return;
    e.preventDefault();
    const vp = this.view.viewport;
    if (e.ctrlKey || e.metaKey) {
      // Zoom about the cursor: the patch point under the pointer stays under it, which
      // is what makes wheel-zoom feel like moving a magnifier rather than a slider.
      const p = this.view.clientToPatch(e);
      this.view.setViewport({ ...vp, zoom: vp.zoom * Math.exp(-e.deltaY * ZOOM_STEP) });
      const zoom = this.view.viewport.zoom; // re-read: the view clamps
      const box = this.svg.getBoundingClientRect();
      this.view.setViewport({
        x: e.clientX - box.left - p.x * zoom,
        y: e.clientY - box.top - p.y * zoom,
        zoom,
      });
    } else {
      this.view.setViewport({ x: vp.x - e.deltaX, y: vp.y - e.deltaY, zoom: vp.zoom });
    }
    this.emitZoom();
  };

  /** The app shell's zoom readout follows this rather than polling. */
  private emitZoom(): void {
    this.svg.dispatchEvent(new CustomEvent('patcher:zoom', { bubbles: true }));
  }

  private status(msg: string): void {
    this.host.onStatus?.(msg);
  }
}

/** Sort a pair of port hits into (outlet, inlet), whichever way the drag went. */
function orient(a: PortHit, b: PortHit): {
  from: { id: string; outlet: number };
  to: { id: string; inlet: number };
} {
  const out = a.dir === 'out' ? a : b;
  const inn = a.dir === 'in' ? a : b;
  return { from: { id: out.id, outlet: out.index }, to: { id: inn.id, inlet: inn.index } };
}
