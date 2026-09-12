// The patcher canvas: the same patch ui/graph.ts draws for the player, but as a living
// DOM that a user edits for hours without it ever being torn down.
//
// WHY THIS IS NOT renderGraph(). That renderer is a pure function of the patch — it
// empties its container and rebuilds every element on every call — which is exactly
// right for a player that loads a file once. In an editor the DOM is not disposable,
// because it holds state that exists nowhere else: a mounted <foreignObject> may contain
// a slider the user is mid-drag on (remount it and the pointer capture, the thumb
// position and the gesture all go), a jit.window <canvas> whose pixels are the only copy
// of the last frame, or a focused text input. Dragging a box emits one set-rect op per
// animation frame, so "rebuild everything" would do all of that sixty times a second.
// renderGraph also normalizes the origin, so deleting the top-left box would appear to
// move every other box on screen. Both renderers therefore stay, sharing every
// coordinate through ui/layout.ts and nothing else.
//
// The contract this file upholds:
//
//   • INCREMENTAL. One <g> per box and one <g> per cord, kept in maps keyed by node id
//     and edgeKey, updated from the doc's op feed by switching on `op.t`. A 'set-rect'
//     writes one transform attribute and the `d` of that box's incident cords — it never
//     touches a <foreignObject> or its child widget. That is the single most important
//     property here and patcher-render.test.ts asserts it directly.
//
//   • TRUE PATCH COORDINATES. Nothing is normalized, ever. Pan and zoom are one
//     transform on one <g>, so an HTML widget inside a foreignObject scales with the
//     patch (a viewBox would too, but writing the transform keeps screen->patch a single
//     matrix inverse that the browser computes for us — see clientToPatch).
//
//   • FOUR LAYERS, in paint order: cords, boxes, ports, overlay. Ports are their own
//     layer AFTER boxes because a foreignObject's HTML content paints above every SVG
//     sibling earlier in document order: a port drawn inside its own box group would be
//     buried under any mounted widget, and a slider would swallow its own port clicks.
//
//   • HIT TESTING IS DOM DELEGATION. hitPort() asks document.elementFromPoint and walks
//     up with closest('[data-port]'). No geometry, so it is correct under any pan/zoom
//     for free, and it stays correct when the CSS moves a port by a pixel.
//
// Gestures live in ui/patcher-input.ts. This file renders, hit-tests and owns the
// viewport; it installs no pointer, keyboard or wheel listeners of its own.

import type { Op } from '../doc/ops';
import { edgeKey } from '../doc/ops';
import type { PatchDoc } from '../doc/patch-doc';
import { isSupported } from '../engine/registry';
import type { Domain, IREdge, IRNode } from '../ir/types';
import {
  boxSize, cordPath, DOMAIN_COLOR, inletPoint, nodeDomain, outletPoint, portHitRect,
  portNubRect, SELF_LABELLED, type LaidBox, type Point,
} from './layout';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lock in run mode, unlock in edit mode — Max's own distinction, not a transport state. */
export type PatcherMode = 'edit' | 'run';

export interface Viewport {
  /** Screen offset of patch origin (0, 0), in CSS pixels. */
  x: number;
  y: number;
  zoom: number;
}

/** One end of a cord, as hitPort() reports it. `dir` is the port's own direction. */
export interface PortHit {
  id: string;
  dir: 'in' | 'out';
  index: number;
}

export interface BoxGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The transient shape a gesture draws on top of the patch. Coordinates are PATCH
 * coordinates (the overlay lives inside the transformed viewport group), so a controller
 * can feed clientToPatch() results straight back in without a second conversion.
 *
 * One shape at a time, because the gestures that produce them are mutually exclusive:
 * you are either drafting a cord or sweeping a marquee.
 */
export type Overlay =
  | { kind: 'cord'; from: Point; to: Point; domain?: Domain; invalid?: boolean }
  | { kind: 'marquee'; x: number; y: number; w: number; h: number };

export interface PatcherOptions {
  doc: PatchDoc;
  /**
   * The DOM the engine built for this box, if any — typically
   * `(id) => engine.built.get(id)?.el`. The element is OWNED BY THE ENGINE: this view
   * mounts it and never clones, rebuilds or disposes it, and re-mounts it only when the
   * identity it gets back actually changes. Call refreshWidgets() after an engine build.
   */
  widgetFor?(id: string): HTMLElement | undefined;
  /** Fired whenever the selected BOX set changes (selecting cords does not fire it). */
  onSelectionChange?(ids: ReadonlySet<string>): void;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
/** Fat invisible stroke that makes a 1.6px cord grabbable. */
const CORD_HIT_W = 12;
const CORD_W: Record<string, number> = { signal: 3, control: 1.6, video: 1.6 };
/** Floors for a box whose authored patching_rect is degenerate or absent. */
const MIN_BOX_W = 38;
const MIN_BOX_H = 18;
const FIT_PAD = 48;
const NEUTRAL = '#7a828c';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Same three lines as ui/graph.ts. Kept local rather than exported from there, because
// graph.ts is the player's renderer and must stay a leaf nothing else depends on.
function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs?: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * Everything this view keeps about one box. More than the `Map<nodeId, SVGGElement>` the
 * plan calls for, and for one reason: an incremental update has to know what is on
 * screen NOW without re-measuring it. `lb` is the box in patch coordinates (its `x/y`
 * are literally what the group's transform says), so a move is a transform write plus a
 * cord reroute, and a widget swap is detected by comparing `widget` by identity.
 */
interface BoxView {
  node: IRNode;
  lb: LaidBox;
  g: SVGGElement;
  ports: SVGGElement;
  body: SVGRectElement;
  accent: SVGRectElement;
  label?: SVGTextElement;
  caption?: SVGTextElement;
  host?: SVGForeignObjectElement;
  widget?: HTMLElement;
}

interface CordView {
  edge: IREdge;
  g: SVGGElement;
  hit: SVGPathElement;
  line: SVGPathElement;
}

export class PatcherView {
  readonly svg: SVGSVGElement;

  private readonly gViewport: SVGGElement;
  private readonly lCords: SVGGElement;
  private readonly lBoxes: SVGGElement;
  private readonly lPorts: SVGGElement;
  private readonly lOverlay: SVGGElement;

  private readonly doc: PatchDoc;
  private readonly opts: PatcherOptions;
  private unsubscribe: (() => void) | null = null;

  private boxes = new Map<string, BoxView>();
  private cords = new Map<string, CordView>();
  /** node id -> the edgeKeys touching it, so a move reroutes O(cords on this box). */
  private incident = new Map<string, Set<string>>();

  // Selection sets are replaced, never mutated in place, so a caller iterating the set
  // it was handed is never invalidated by the next select().
  private sel: ReadonlySet<string> = new Set();
  private selEdges: ReadonlySet<string> = new Set();

  private vp: Viewport = { x: 0, y: 0, zoom: 1 };
  private m: PatcherMode = 'edit';
  private overlayEl: SVGElement | null = null;
  private overlayKind: Overlay['kind'] | null = null;
  private destroyed = false;
  /** Reused source point for clientToPatch; matrixTransform allocates the result. */
  private readonly probe = new DOMPoint();

  constructor(container: HTMLElement, opts: PatcherOptions) {
    this.doc = opts.doc;
    this.opts = opts;

    this.svg = el('svg', { class: 'patcher', tabindex: 0, width: '100%', height: '100%' });
    this.gViewport = el('g', { class: 'viewport' });
    this.lCords = el('g', { class: 'layer layer-cords' });
    this.lBoxes = el('g', { class: 'layer layer-boxes' });
    this.lPorts = el('g', { class: 'layer layer-ports' });
    this.lOverlay = el('g', { class: 'layer layer-overlay' });
    // The overlay is decoration for a gesture already in progress; if it could be hit it
    // would steal the very pointermove that is drawing it.
    this.lOverlay.style.pointerEvents = 'none';
    this.gViewport.append(this.lCords, this.lBoxes, this.lPorts, this.lOverlay);
    this.svg.appendChild(this.gViewport);
    container.appendChild(this.svg);

    this.applyMode();
    this.applyViewport();
    this.syncAll();
    this.unsubscribe = this.doc.on((ops) => this.applyOps(ops));
  }

  // ---------------------------------------------------------------------------
  // mode
  // ---------------------------------------------------------------------------

  get mode(): PatcherMode {
    return this.m;
  }

  /**
   * Edit vs run. Independent of the transport: Max keeps DSP running while you patch.
   *
   * The root gets `mode-edit` / `mode-run` for chrome styling, but the three rules that
   * decide where a click LANDS are written here as element styles rather than left to a
   * stylesheet. They are behavior, not decoration — if patcher.css failed to load, a
   * stylesheet-only version would leave every mounted slider eating the drag that was
   * meant to move its box, with no visible sign anything was wrong.
   */
  setMode(m: PatcherMode): void {
    if (m === this.m) return;
    this.m = m;
    this.applyMode();
  }

  private applyMode(): void {
    const editing = this.m === 'edit';
    this.svg.classList.toggle('mode-edit', editing);
    this.svg.classList.toggle('mode-run', !editing);
    // Ports are meaningless when the patch is locked, and a hidden layer can't be hit.
    this.lPorts.style.display = editing ? '' : 'none';
    // In run mode a click on a cord should fall through to whatever is behind it.
    this.lCords.style.pointerEvents = editing ? '' : 'none';
    for (const view of this.boxes.values()) this.applyHostMode(view);
  }

  private applyHostMode(view: BoxView): void {
    // Edit mode: the widget is scenery, so pointers reach the box body underneath and a
    // drag moves the box without moving the slider's value.
    if (view.host) view.host.style.pointerEvents = this.m === 'edit' ? 'none' : 'auto';
  }

  // ---------------------------------------------------------------------------
  // selection
  // ---------------------------------------------------------------------------

  /** The selected boxes. A snapshot: select() replaces the set rather than mutating it. */
  get selection(): ReadonlySet<string> {
    return this.sel;
  }

  /** The selected cords, by edgeKey. */
  get selectedEdges(): ReadonlySet<string> {
    return this.selEdges;
  }

  /**
   * Select boxes. `additive` unions with the current selection and leaves any selected
   * cords alone; a replacing select() clears the cord selection too, because it is one
   * selection with two kinds of thing in it and a fresh pick replaces all of it.
   *
   * Union, not toggle: shift-clicking an already-selected box is the controller's
   * decision to express, and it can — by handing over the set it wants.
   */
  select(ids: Iterable<string>, additive = false): void {
    const next = new Set(additive ? this.sel : []);
    for (const id of ids) if (this.boxes.has(id)) next.add(id);
    this.setSelection(next, additive ? this.selEdges : new Set());
  }

  /** Select cords by edgeKey. Mirrors select(). */
  selectEdges(keys: Iterable<string>, additive = false): void {
    const next = new Set(additive ? this.selEdges : []);
    for (const k of keys) if (this.cords.has(k)) next.add(k);
    this.setSelection(additive ? this.sel : new Set(), next);
  }

  private setSelection(next: ReadonlySet<string>, nextEdges: ReadonlySet<string>): void {
    const changed = !sameSet(this.sel, next);
    for (const id of this.sel) if (!next.has(id)) this.markBox(id, false);
    for (const id of next) if (!this.sel.has(id)) this.markBox(id, true);
    for (const k of this.selEdges) if (!nextEdges.has(k)) this.markCord(k, false);
    for (const k of nextEdges) if (!this.selEdges.has(k)) this.markCord(k, true);
    this.sel = next;
    this.selEdges = nextEdges;
    if (changed) this.opts.onSelectionChange?.(next);
  }

  // Selection is a class on elements that already exist. An extra outline <rect> would
  // be one more thing between the pointer and the box it is trying to hit.
  private markBox(id: string, on: boolean): void {
    const view = this.boxes.get(id);
    if (!view) return;
    view.g.classList.toggle('selected', on);
    view.ports.classList.toggle('selected', on);
  }

  private markCord(key: string, on: boolean): void {
    this.cords.get(key)?.g.classList.toggle('selected', on);
  }

  // ---------------------------------------------------------------------------
  // viewport
  // ---------------------------------------------------------------------------

  /** `translate(x, y) scale(zoom)`: patch point p is at screen `x + p * zoom`. */
  get viewport(): Viewport {
    return { ...this.vp };
  }

  setViewport(v: Viewport): void {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.zoom)) return;
    this.vp = { x: v.x, y: v.y, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) };
    this.applyViewport();
  }

  private applyViewport(): void {
    const { x, y, zoom } = this.vp;
    this.gViewport.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`);
  }

  /**
   * Frame every box. Never magnifies past 1:1 — a two-box patch blown up to fill a
   * 1400px canvas is disorienting, and Max doesn't do it either.
   */
  fit(padding = FIT_PAD): void {
    const views = [...this.boxes.values()];
    if (views.length === 0) {
      this.setViewport({ x: padding, y: padding, zoom: 1 });
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { lb } of views) {
      minX = Math.min(minX, lb.x);
      minY = Math.min(minY, lb.y);
      maxX = Math.max(maxX, lb.x + lb.w);
      maxY = Math.max(maxY, lb.y + lb.h);
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const box = this.svg.getBoundingClientRect();
    // A view that isn't laid out yet (display:none, or fit() before the first frame) has
    // no size to fit into; park the patch at the padding rather than divide by zero.
    if (box.width < 1 || box.height < 1) {
      this.setViewport({ x: padding - minX, y: padding - minY, zoom: 1 });
      return;
    }
    const zoom = clamp(
      Math.min((box.width - 2 * padding) / w, (box.height - 2 * padding) / h),
      MIN_ZOOM,
      1
    );
    this.setViewport({
      x: (box.width - w * zoom) / 2 - minX * zoom,
      y: (box.height - h * zoom) / 2 - minY * zoom,
      zoom,
    });
  }

  /**
   * Screen -> patch, the one conversion everything else is built on.
   *
   * getScreenCTM() is taken on the VIEWPORT GROUP rather than on the <svg>, because the
   * group's CTM already folds in the pan/zoom transform: the exact form of that
   * transform is written in applyViewport() and read nowhere, so there is no second
   * place to keep in step. The manual fallback is for a view that is detached or
   * display:none, where getScreenCTM() returns null.
   */
  clientToPatch(e: { clientX: number; clientY: number }): Point {
    const ctm = this.gViewport.getScreenCTM();
    if (ctm) {
      this.probe.x = e.clientX;
      this.probe.y = e.clientY;
      const p = this.probe.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    const box = this.svg.getBoundingClientRect();
    return {
      x: (e.clientX - box.left - this.vp.x) / this.vp.zoom,
      y: (e.clientY - box.top - this.vp.y) / this.vp.zoom,
    };
  }

  // ---------------------------------------------------------------------------
  // geometry + hit testing
  // ---------------------------------------------------------------------------

  /** A box's rendered rect in patch coordinates — what the user sees, not patching_rect. */
  boxGeom(id: string): BoxGeom | undefined {
    const lb = this.boxes.get(id)?.lb;
    return lb ? { x: lb.x, y: lb.y, w: lb.w, h: lb.h } : undefined;
  }

  /**
   * Where a cord at this port attaches, in patch coordinates — the anchor a rubber cord
   * hangs off. Here rather than in the controller so the "inlets on top, outlets on the
   * bottom edge" rule stays in ui/layout.ts and is stated once.
   */
  portPoint(id: string, dir: 'in' | 'out', index: number): Point | undefined {
    const view = this.boxes.get(id);
    if (!view) return undefined;
    return dir === 'in' ? inletPoint(view.lb, index) : outletPoint(view.lb, index);
  }

  /**
   * The port under a client point, or the nearest one within `maxDist` CSS pixels.
   *
   * Pure DOM delegation: whatever the browser says is on top at that pixel, walked up to
   * the nearest [data-port]. That is what makes it right under any zoom, and what makes
   * a hidden ports layer (run mode) report no port without a special case.
   *
   * `maxDist` is the cord-snap radius and is measured on SCREEN, like the gesture it
   * serves — snapping should feel the same at every zoom level. It is implemented as
   * rings of probe points rather than as geometry, for the same reason as above; the
   * rings run outward so the first hit is the nearest one, to within a ring.
   *
   * `want` narrows the search to inlets or to outlets, and a cord drag MUST pass it.
   * Without it the search stops at the first port of any direction it finds, and the
   * ring probes run downward first — so a cord dropped on the body of a 22px-tall box
   * found that box's own OUTLET row through the bottom edge, the caller discarded it as
   * facing the wrong way, and the drop silently produced nothing at all. Filtering here
   * instead lets the search keep looking and reach the inlet that was also in range.
   */
  hitPort(
    clientX: number,
    clientY: number,
    maxDist = 0,
    want?: 'in' | 'out',
  ): PortHit | undefined {
    const direct = this.portAt(clientX, clientY, want);
    if (direct || maxDist <= 0) return direct;
    for (const r of [maxDist / 3, (2 * maxDist) / 3, maxDist]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        const hit = this.portAt(clientX + r * Math.cos(a), clientY + r * Math.sin(a), want);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  private portAt(clientX: number, clientY: number, want?: 'in' | 'out'): PortHit | undefined {
    const target = document.elementFromPoint(clientX, clientY);
    const port = target?.closest('[data-port]');
    // A second PatcherView (or any other SVG) on the page is not ours to report on.
    if (!port || !this.svg.contains(port)) return undefined;
    const id = port.getAttribute('data-box');
    const dir = port.getAttribute('data-dir');
    const index = Number(port.getAttribute('data-index'));
    if (!id || (dir !== 'in' && dir !== 'out') || !Number.isInteger(index)) return undefined;
    if (want && dir !== want) return undefined;
    return { id, dir, index };
  }

  /**
   * The port of `id` facing `dir` whose nub is nearest a client x — Max's rule for a
   * cord released on the BODY of a box rather than on a nub: the whole object is a drop
   * target and the nearest inlet wins.
   *
   * Read off the rendered elements rather than recomputed from ui/layout, for the same
   * reason portCentre() is in the test helpers: a hit test that agreed with the layout
   * module even when the layout module and the DOM had diverged would be blind to the
   * one bug it most needs to see.
   */
  nearestPort(id: string, dir: 'in' | 'out', clientX: number): PortHit | undefined {
    const ports = this.svg.querySelectorAll<SVGRectElement>(
      `[data-port][data-box="${CSS.escape(id)}"][data-dir="${dir}"]`,
    );
    let best: PortHit | undefined;
    let bestDist = Infinity;
    for (const port of ports) {
      const index = Number(port.getAttribute('data-index'));
      if (!Number.isInteger(index)) continue;
      const r = port.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - clientX);
      if (dist < bestDist) {
        bestDist = dist;
        best = { id, dir, index };
      }
    }
    return best;
  }

  /** The box under a client point, by the same delegation. */
  hitBox(clientX: number, clientY: number): string | undefined {
    const target = document.elementFromPoint(clientX, clientY);
    const box = target?.closest('[data-box]');
    if (!box || !this.svg.contains(box)) return undefined;
    return box.getAttribute('data-box') ?? undefined;
  }

  /** Is this client point inside the canvas at all? Chrome around it is not the patch. */
  contains(clientX: number, clientY: number): boolean {
    const r = this.svg.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** The cord under a client point, as an edgeKey. */
  hitCord(clientX: number, clientY: number): string | undefined {
    const target = document.elementFromPoint(clientX, clientY);
    const cord = target?.closest('[data-edge]');
    if (!cord || !this.svg.contains(cord)) return undefined;
    return cord.getAttribute('data-edge') ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // overlay
  // ---------------------------------------------------------------------------

  /**
   * Draw (or clear) the transient shape of a gesture in progress. The element is reused
   * between calls with the same kind, because this runs on every pointermove.
   */
  setOverlay(o: Overlay | null): void {
    if (!o) {
      this.lOverlay.replaceChildren();
      this.overlayEl = null;
      this.overlayKind = null;
      return;
    }
    if (this.overlayKind !== o.kind) {
      this.overlayEl =
        o.kind === 'cord'
          ? el('path', { class: 'overlay-cord', fill: 'none', 'stroke-linecap': 'round' })
          : el('rect', { class: 'overlay-marquee' });
      this.overlayKind = o.kind;
      this.lOverlay.replaceChildren(this.overlayEl);
    }
    const node = this.overlayEl;
    if (!node) return;
    if (o.kind === 'cord') {
      const domain = o.domain ?? 'control';
      node.setAttribute('d', cordPath(o.from, o.to));
      node.setAttribute('stroke', DOMAIN_COLOR[domain] ?? NEUTRAL);
      node.setAttribute('stroke-width', String(CORD_W[domain] ?? 1.6));
      // A refused drop still tracks the pointer — it just says so, rather than vanishing.
      node.setAttribute('stroke-dasharray', o.invalid ? '5 4' : 'none');
      node.classList.toggle('invalid', o.invalid === true);
    } else {
      // A marquee swept up or left arrives with a negative extent; SVG wants it positive.
      const x = o.w < 0 ? o.x + o.w : o.x;
      const y = o.h < 0 ? o.y + o.h : o.y;
      node.setAttribute('x', String(x));
      node.setAttribute('y', String(y));
      node.setAttribute('width', String(Math.abs(o.w)));
      node.setAttribute('height', String(Math.abs(o.h)));
      node.setAttribute('fill', 'rgba(90, 169, 230, 0.12)');
      node.setAttribute('stroke', DOMAIN_COLOR.control ?? NEUTRAL);
      node.setAttribute('stroke-dasharray', '4 3');
    }
  }

  // ---------------------------------------------------------------------------
  // widgets
  // ---------------------------------------------------------------------------

  /**
   * Re-read every box's widget after an engine build.
   *
   * Only the boxes whose element actually CHANGED identity are touched, so calling this
   * after a rebuild that replaced one object leaves the other widgets — and anything the
   * user is doing to them — alone.
   */
  refreshWidgets(): void {
    for (const view of this.boxes.values()) {
      if (this.opts.widgetFor?.(view.node.id) !== view.widget) this.updateBox(view, view.node);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    // The widgets belong to the engine; detaching the SVG is as far as this goes.
    this.svg.remove();
    this.boxes.clear();
    this.cords.clear();
    this.incident.clear();
    this.sel = new Set();
    this.selEdges = new Set();
  }

  // ---------------------------------------------------------------------------
  // the op feed
  // ---------------------------------------------------------------------------

  /**
   * One transaction's worth of ops, applied in order.
   *
   * The document guarantees a replayable order (cords come off before the box they touch
   * is re-instantiated, and back on after), so in-order application never sees an
   * impossible state. `stale` is the escape hatch for the one thing that could still go
   * wrong — an op naming something this view doesn't have, which can only mean the two
   * have drifted — and it costs a full resync exactly once rather than leaving a cord
   * that never appears.
   */
  private applyOps(ops: readonly Op[]): void {
    if (this.destroyed) return;
    let stale = false;
    for (const op of ops) {
      switch (op.t) {
        case 'add-node': {
          const node = this.doc.node(op.node.id) ?? op.node;
          const existing = this.boxes.get(node.id);
          if (existing) this.updateBox(existing, node);
          else this.createBox(node);
          break;
        }
        case 'remove-node':
          stale = !this.destroyBox(op.node.id) || stale;
          break;
        case 'set-rect':
          stale = !this.moveBox(op.id, op.to) || stale;
          break;
        case 'set-box': {
          const view = this.boxes.get(op.id);
          const node = this.doc.node(op.id);
          if (view && node) this.updateBox(view, node);
          else stale = true;
          break;
        }
        case 'add-edge':
          stale = !this.createCord(op.edge) || stale;
          break;
        case 'remove-edge':
          stale = !this.destroyCord(edgeKey(op.edge)) || stale;
          break;
        case 'renumber':
          this.applyRenumber(op.map, op.edgeMap);
          break;
      }
    }
    if (stale) this.syncAll();
  }

  /** Rebuild whatever has drifted from the document. Also the initial render. */
  private syncAll(): void {
    const live = new Set<string>();
    for (const node of this.doc.nodes()) {
      live.add(node.id);
      const view = this.boxes.get(node.id);
      if (!view) this.createBox(node);
      else if (view.node !== node) this.updateBox(view, node);
    }
    for (const id of [...this.boxes.keys()]) if (!live.has(id)) this.destroyBox(id);

    const liveCords = new Set<string>();
    for (const edge of this.doc.edges()) {
      const key = edgeKey(edge);
      liveCords.add(key);
      const view = this.cords.get(key);
      if (!view) this.createCord(edge);
      else if (view.edge !== edge) {
        view.edge = edge;
        this.paintCord(view);
      }
    }
    for (const key of [...this.cords.keys()]) if (!liveCords.has(key)) this.destroyCord(key);
  }

  // ---------------------------------------------------------------------------
  // boxes
  // ---------------------------------------------------------------------------

  /**
   * Rendered size of a box.
   *
   * Unlike the player, an authored `patching_rect` width WINS over the width derived
   * from the text. The player re-derives because it renders a file it will never write
   * back; an editor has to draw the box it is going to save, or reopening the patch in
   * Max would move every cord's attachment point. A mounted widget is the exception —
   * its Max box is typically 20x15, which is not a thing anyone can use with a mouse, so
   * boxSize()'s usable size stands.
   */
  private laidOut(node: IRNode, widget: HTMLElement | undefined): LaidBox {
    const [dw, dh] = boxSize(node, widget);
    const [x, y, aw, ah] = node.rect;
    return {
      x,
      y,
      w: widget ? dw : Math.max(aw > 0 ? aw : dw, MIN_BOX_W),
      h: widget ? dh : Math.max(ah > 0 ? ah : dh, MIN_BOX_H),
      node,
      widget,
      authoredRect: [...node.rect],
    };
  }

  private createBox(node: IRNode): BoxView {
    const g = el('g', { class: 'box', 'data-box': node.id });
    const body = el('rect', { class: 'box-body', x: 0, y: 0, width: 0, height: 0, rx: 4 });
    const accent = el('rect', { class: 'box-accent', x: 0, y: 0, width: 3.5, height: 0 });
    g.append(body, accent);
    const ports = el('g', { class: 'ports', 'data-box': node.id });
    this.lBoxes.appendChild(g);
    this.lPorts.appendChild(ports);

    const view: BoxView = {
      node,
      lb: this.laidOut(node, this.opts.widgetFor?.(node.id)),
      g,
      ports,
      body,
      accent,
    };
    this.boxes.set(node.id, view);
    this.updateBox(view, node);
    return view;
  }

  /**
   * Bring one box fully up to date with a (possibly new) node: size, text, class, ports,
   * widget, and the cords that hang off it.
   *
   * Everything is updated in place. The <g>, the body rect and — crucially — the
   * <foreignObject> and the widget inside it survive, so retyping `slider @size 10` does
   * not reset the slider the user is holding. The widget is remounted only when
   * widgetFor() hands back a DIFFERENT element, which is to say only when the engine
   * really did rebuild that object.
   */
  private updateBox(view: BoxView, node: IRNode): void {
    const widget = this.opts.widgetFor?.(node.id);
    view.node = node;
    view.lb = this.laidOut(node, widget);
    view.g.setAttribute('data-box', node.id);
    view.ports.setAttribute('data-box', node.id);

    const domain = nodeDomain(node);
    // Three visual states, and they mean different things: a Tier-A stub is an object
    // this app knows and can wire but cannot yet SOUND, while known === false is a name
    // no Max object has — a typo, or an object from a package we have no metadata for.
    const stub = node.known !== false && !isSupported(node.className);
    view.g.setAttribute(
      'class',
      `box box-${domain}${widget ? ' box-widget' : ''}${stub ? ' node-stub' : ''}` +
        `${node.known === false ? ' box-unknown' : ''}${this.sel.has(node.id) ? ' selected' : ''}`
    );
    view.accent.setAttribute('fill', DOMAIN_COLOR[domain] ?? NEUTRAL);
    // Presentation attributes, so the canvas is legible with no stylesheet at all; any
    // CSS rule on .box-body outranks them.
    view.body.setAttribute('fill', '#23272f');
    view.body.setAttribute('stroke', node.known === false ? '#c2554e' : stub ? '#4a3a3a' : '#3a414c');
    view.body.setAttribute('stroke-dasharray', stub || node.known === false ? '4 3' : 'none');

    this.placeBox(view);
    this.syncWidget(view, widget);
    this.buildPorts(view);
    // Repaint too: a retype can change an outlet's domain, and the cords hanging off it
    // are the only thing on screen that says so.
    this.rerouteIncident(node.id, true);
  }

  /** The one write a move costs: the group transform (ports ride along on their own). */
  private placeBox(view: BoxView): void {
    const { x, y, w, h } = view.lb;
    const transform = `translate(${x} ${y})`;
    view.g.setAttribute('transform', transform);
    view.ports.setAttribute('transform', transform);
    view.body.setAttribute('width', String(w));
    view.body.setAttribute('height', String(h));
    view.accent.setAttribute('height', String(h));
  }

  private syncWidget(view: BoxView, widget: HTMLElement | undefined): void {
    const text = view.node.text || view.node.className;
    if (widget) {
      if (!view.host) {
        view.host = el('foreignObject', { class: 'widget-host' });
        view.g.appendChild(view.host);
      }
      if (view.widget !== widget) {
        // Re-appending the SAME element would still be a remove + insert, which is
        // enough to drop focus and cancel a pointer capture. Only swap on a real change.
        view.host.replaceChildren(widget);
        widget.classList.add('max-widget');
        view.widget = widget;
      }
      view.host.setAttribute('x', '0');
      view.host.setAttribute('y', '0');
      view.host.setAttribute('width', String(view.lb.w));
      view.host.setAttribute('height', String(view.lb.h));
      this.applyHostMode(view);
      // A bare slider says nothing about what it does; the box text goes above it. A
      // widget that draws its own text (a message box, a comment) is the exception —
      // captioning it prints the same string twice, once above the box and once in it.
      if (SELF_LABELLED.has(view.node.className)) {
        view.caption?.remove();
        view.caption = undefined;
      } else {
        if (!view.caption) {
          view.caption = el('text', {
            class: 'box-caption', x: 1, y: -5, fill: '#8a8f98',
            'font-family': 'ui-monospace, Menlo, monospace', 'font-size': 10,
          });
          view.g.appendChild(view.caption);
        }
        view.caption.textContent = text;
      }
      view.label?.remove();
      view.label = undefined;
      return;
    }

    if (view.host) {
      view.host.remove();
      view.host = undefined;
      view.widget = undefined;
    }
    view.caption?.remove();
    view.caption = undefined;
    if (!view.label) {
      // Presentation attributes rather than inline style, so patcher.css can restyle the
      // label; an inline style would outrank every rule the stylesheet could write.
      view.label = el('text', {
        class: 'box-label', fill: '#e6e9ef', 'font-family': 'ui-monospace, Menlo, monospace',
        'font-size': 11, 'dominant-baseline': 'middle',
      });
      view.g.appendChild(view.label);
    }
    view.label.setAttribute('x', '10');
    view.label.setAttribute('y', String(view.lb.h / 2));
    view.label.textContent = text;
  }

  /**
   * (Re)build one box's ports. Rects are in box-LOCAL coordinates so the whole group
   * rides on the box's transform and a move never touches them.
   */
  private buildPorts(view: BoxView): void {
    const local: LaidBox = { ...view.lb, x: 0, y: 0 };
    const node = view.node;
    const frag = document.createDocumentFragment();
    const add = (dir: 'in' | 'out', index: number, count: number, color: string) => {
      const kind = dir === 'in' ? 'inlet' : 'outlet';
      const nub = portNubRect(local, kind, index, count);
      const n = el('rect', {
        class: 'port-nub',
        x: nub.x, y: nub.y, width: nub.width, height: nub.height, fill: color,
      });
      n.style.pointerEvents = 'none'; // the nub is paint; the hit rect below is the target
      const hit = portHitRect(local, kind, index, count);
      const r = el('rect', {
        class: 'port',
        'data-port': '',
        'data-box': node.id,
        'data-dir': dir,
        'data-index': index,
        x: hit.x, y: hit.y, width: hit.width, height: hit.height,
        fill: 'transparent',
      });
      // `all` rather than relying on a transparent fill being "painted": this rect exists
      // only to be hit, and its fill is an implementation detail of how it hides.
      r.style.pointerEvents = 'all';
      frag.append(n, r);
    };

    for (let i = 0; i < node.numInlets; i++) add('in', i, node.numInlets, NEUTRAL);
    for (let i = 0; i < node.numOutlets; i++) {
      add('out', i, node.numOutlets, DOMAIN_COLOR[node.outletDomains[i] ?? 'control'] ?? NEUTRAL);
    }
    view.ports.replaceChildren(frag);
  }

  /**
   * A move: one transform write plus the cords that hang off this box. Nothing here
   * re-creates an element, which is what keeps a mounted widget (and any drag in
   * progress on it) intact through a 60fps drag of its box.
   */
  private moveBox(id: string, rect: IRNode['rect']): boolean {
    const view = this.boxes.get(id);
    if (!view) return false;
    // The document replaced the node object when it applied the op, so re-read it: a
    // stale node here would carry the old rect and put the box back on the next
    // updateBox() (refreshWidgets, a retype) as if the move had never happened.
    const node = this.doc.node(id) ?? view.node;
    view.node = node;
    view.lb.node = node;

    const resized = rect[2] !== view.lb.authoredRect[2] || rect[3] !== view.lb.authoredRect[3];
    view.lb.x = rect[0];
    view.lb.y = rect[1];
    view.lb.authoredRect = [...rect];
    // Resize isn't modelled this pass (maxpylang has no public box-width API), but an
    // authored size that DID change still has to reach the body rect and the ports — and
    // can, without re-creating a single element, which is the whole point of this path.
    if (resized && !view.widget) {
      view.lb.w = Math.max(rect[2] > 0 ? rect[2] : view.lb.w, MIN_BOX_W);
      view.lb.h = Math.max(rect[3] > 0 ? rect[3] : view.lb.h, MIN_BOX_H);
    }
    this.placeBox(view);
    if (resized && !view.widget) {
      view.label?.setAttribute('y', String(view.lb.h / 2));
      this.buildPorts(view);
    }
    this.rerouteIncident(id);
    return true;
  }

  private destroyBox(id: string): boolean {
    const view = this.boxes.get(id);
    if (!view) return false;
    // Cords first, so nothing is left pointing at a box that is gone. The document sends
    // remove-edge ops ahead of remove-node, so this is normally a no-op.
    for (const key of [...(this.incident.get(id) ?? [])]) this.destroyCord(key);
    this.incident.delete(id);
    view.g.remove();
    view.ports.remove();
    this.boxes.delete(id);
    if (this.sel.has(id)) {
      const next = new Set(this.sel);
      next.delete(id);
      this.setSelection(next, this.selEdges);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // cords
  // ---------------------------------------------------------------------------

  private createCord(edge: IREdge): boolean {
    const key = edgeKey(edge);
    const existing = this.cords.get(key);
    if (existing) {
      existing.edge = edge;
      this.paintCord(existing);
      return true;
    }
    if (!this.boxes.has(edge.from.id) || !this.boxes.has(edge.to.id)) return false;

    const g = el('g', { class: 'cord', 'data-edge': key });
    const hit = el('path', {
      class: 'cord-hit', fill: 'none', stroke: 'transparent', 'stroke-width': CORD_HIT_W,
    });
    // Hit on the stroke alone: the area a cubic "encloses" is not part of the cord.
    hit.style.pointerEvents = 'stroke';
    const line = el('path', {
      class: 'cord-line', fill: 'none', 'stroke-linecap': 'round', 'stroke-opacity': 0.85,
    });
    line.style.pointerEvents = 'none';
    g.append(hit, line);
    this.lCords.appendChild(g);

    const view: CordView = { edge, g, hit, line };
    this.cords.set(key, view);
    this.indexEdge(edge.from.id, key);
    this.indexEdge(edge.to.id, key);
    this.paintCord(view);
    this.routeCord(view);
    return true;
  }

  private destroyCord(key: string): boolean {
    const view = this.cords.get(key);
    if (!view) return false;
    view.g.remove();
    this.cords.delete(key);
    this.incident.get(view.edge.from.id)?.delete(key);
    this.incident.get(view.edge.to.id)?.delete(key);
    if (this.selEdges.has(key)) {
      const next = new Set(this.selEdges);
      next.delete(key);
      this.setSelection(this.sel, next);
    }
    return true;
  }

  private indexEdge(id: string, key: string): void {
    let set = this.incident.get(id);
    if (!set) this.incident.set(id, (set = new Set()));
    set.add(key);
  }

  /**
   * Colour and weight come from the SOURCE OUTLET's domain, read off the live node
   * rather than off the edge: retyping `cycle~ 440` to `+ 1` turns its cords from signal
   * to control, and the node is the one that knows first.
   */
  private paintCord(view: CordView): void {
    const src = this.boxes.get(view.edge.from.id);
    const domain = src?.node.outletDomains[view.edge.from.outlet] ?? view.edge.domain;
    view.line.setAttribute('stroke', DOMAIN_COLOR[domain] ?? NEUTRAL);
    view.line.setAttribute('stroke-width', String(CORD_W[domain] ?? 1.6));
    view.g.setAttribute('data-domain', domain);
  }

  private routeCord(view: CordView): void {
    const src = this.boxes.get(view.edge.from.id);
    const dst = this.boxes.get(view.edge.to.id);
    if (!src || !dst) return;
    const d = cordPath(outletPoint(src.lb, view.edge.from.outlet), inletPoint(dst.lb, view.edge.to.inlet));
    view.hit.setAttribute('d', d);
    view.line.setAttribute('d', d);
  }

  private rerouteIncident(id: string, repaint = false): void {
    for (const key of this.incident.get(id) ?? []) {
      const view = this.cords.get(key);
      if (!view) continue;
      this.routeCord(view);
      if (repaint) this.paintCord(view);
    }
  }

  // ---------------------------------------------------------------------------
  // renumber
  // ---------------------------------------------------------------------------

  /**
   * Re-key everything under the new ids, drawing nothing.
   *
   * A renumber renames boxes and therefore every cord's edgeKey, and the document hands
   * over both maps precisely so a consumer never has to take a key apart. Note the node
   * and edge objects are REPLACED by the document (an id is part of the node), so the
   * cached references have to be re-read or this view would keep reporting old ids.
   */
  private applyRenumber(map: Record<string, string>, edgeMap: Record<string, string>): void {
    const boxes = new Map<string, BoxView>();
    for (const [id, view] of this.boxes) {
      const next = map[id] ?? id;
      const node = this.doc.node(next);
      if (node) {
        view.node = node;
        view.lb.node = node;
      }
      view.g.setAttribute('data-box', next);
      view.ports.setAttribute('data-box', next);
      for (const port of view.ports.querySelectorAll('[data-port]')) {
        port.setAttribute('data-box', next);
      }
      boxes.set(next, view);
    }
    this.boxes = boxes;

    const cords = new Map<string, CordView>();
    const incident = new Map<string, Set<string>>();
    for (const [key, view] of this.cords) {
      const next = edgeMap[key] ?? key;
      const edge = this.doc.edge(next);
      if (edge) view.edge = edge;
      view.g.setAttribute('data-edge', next);
      cords.set(next, view);
      for (const end of [view.edge.from.id, view.edge.to.id]) {
        let set = incident.get(end);
        if (!set) incident.set(end, (set = new Set()));
        set.add(next);
      }
    }
    this.cords = cords;
    this.incident = incident;

    const sel = new Set([...this.sel].map((id) => map[id] ?? id));
    const selEdges = new Set([...this.selEdges].map((k) => edgeMap[k] ?? k));
    this.sel = sel;
    this.selEdges = selEdges;
    // The same boxes are selected, but under new names — anything keyed by id (the
    // inspector) has to hear about it.
    this.opts.onSelectionChange?.(sel);
  }
}
