// The visual patch: each example drawn as a Max patch, beside its code, the way
// maxpy-studio shows a generated patch next to the Python that made it.
//
// The drawing is web's own PatcherView (web/src/ui/patcher.ts), the canvas MaxPyStudio
// edits with, used read-only and unchanged: the same boxes, ports, cords and colours a
// reader gets after ↗ "open in MaxPyStudio". While an example plays, its UI objects
// (number boxes, sliders, toggles…) are the live widgets the engine built, so they move.
//
// Interaction, as in maxpy-studio's graph: drag the background to pan, drag a box to
// move it, ⌘/Ctrl + scroll (or pinch) to zoom, and buttons to zoom, fit and expand.
// Plain scrolling is left to the page.

import '../../web/src/ui/patch.css'; // widget styles only; every rule is scoped to .max-widget
import { PatcherView, type Viewport } from '../../web/src/ui/patcher';
import { PatchDoc } from '../../web/src/doc/patch-doc';
import { parseMaxPat } from '../../web/src/parser/maxpat';
import { textWidth } from '../../web/src/ui/layout';

type Box = { box: { id: string; maxclass: string; text?: string; patching_rect?: number[] } };
type Line = { patchline: { source: [string, number]; destination: [string, number] } };
type Patch = { patcher: { boxes: Box[]; lines: Line[] } };

const ROW = 40, GAP = 18, PAD = 20, BOX_H = 22;

/**
 * A copy of the patch laid out for reading: each box one row below the lowest box that
 * feeds it, so signal flows top to bottom as in a Max patch, and as close as it fits
 * under the boxes that feed it, so chains run straight down and cords rarely cross.
 *
 * Why: the examples call place() without set_position(), and maxpylang then puts each
 * object one grid step right of the last, so the saved patch is a single long row.
 */
export function layoutForReading(patch: unknown): unknown {
  const copy = structuredClone(patch) as Patch;
  const { boxes, lines } = copy.patcher;

  // A feedback loop (tapin~ -> tapout~ -> back into the mix) has no top. A depth-first
  // search finds the cord that closes each loop; rows are computed without those cords,
  // which are still drawn, as the one cord that runs upward.
  const out = new Map<string, string[]>();
  for (const { patchline: l } of lines) out.set(l.source[0], [...(out.get(l.source[0]) ?? []), l.destination[0]]);
  const state = new Map<string, 'open' | 'done'>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 'open') back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 'done');
  };
  const hasInput = new Set(lines.map(({ patchline: l }) => l.destination[0]));
  for (const { box } of boxes) if (!hasInput.has(box.id) && !state.has(box.id)) visit(box.id);
  for (const { box } of boxes) if (!state.has(box.id)) visit(box.id);
  const forward = lines.filter(({ patchline: l }) => !back.has(`${l.source[0]}>${l.destination[0]}`));

  // Longest path from the top, along forward cords only.
  const row = new Map(boxes.map(({ box }) => [box.id, 0]));
  for (let pass = 0; pass < boxes.length; pass++) {
    let changed = false;
    for (const { patchline: l } of forward) {
      const r = row.get(l.source[0])! + 1;
      if (r > row.get(l.destination[0])!) { row.set(l.destination[0], r); changed = true; }
    }
    if (!changed) break;
  }
  // Text boxes are sized to their text. Interface objects (a 4-button radiogroup, a
  // kslider, a matrixctrl) keep the size they were saved with, or they'd be clipped.
  const textBox = (b: Box['box']) => b.maxclass === 'newobj' || b.maxclass === 'message' || b.maxclass === 'comment';
  const saved = (b: Box['box'], i: 2 | 3) => (!textBox(b) && (b.patching_rect?.[i] ?? 0) > 0 ? b.patching_rect![i] : 0);
  const width = (b: Box['box']) =>
    saved(b, 2) || Math.max(38, textWidth(b.maxclass === 'newobj' || b.maxclass === 'message' ? b.text ?? '' : b.maxclass) + 14);
  const height = (b: Box['box']) => saved(b, 3) || BOX_H;
  const parents = new Map<string, string[]>();
  for (const { patchline: l } of forward) {
    if (row.get(l.source[0])! < row.get(l.destination[0])!) {
      parents.set(l.destination[0], [...(parents.get(l.destination[0]) ?? []), l.source[0]]);
    }
  }
  const left = new Map<string, number>();
  const rows = [...new Set(row.values())].sort((a, b) => a - b);
  let top = PAD;
  for (const r of rows) {
    // Want each box at the average x of its parents; keep the original order otherwise.
    const inRow = boxes.map((b) => b.box).filter((b) => row.get(b.id) === r);
    const want = inRow.map((b, i) => {
      const ps = (parents.get(b.id) ?? []).filter((p) => left.has(p));
      return { b, i, x: ps.length ? ps.reduce((s, p) => s + left.get(p)!, 0) / ps.length : PAD + i * 0 };
    }).sort((a, b) => a.x - b.x || a.i - b.i);
    let cursor = PAD;
    for (const { b, x } of want) {
      const at = Math.max(cursor, x);
      left.set(b.id, at);
      b.patching_rect = [at, top, width(b), height(b)];
      cursor = at + width(b) + GAP;
    }
    // Each row is as tall as its tallest box, plus room for the cords between rows.
    top += Math.max(BOX_H, ...inRow.map(height)) + (ROW - BOX_H);
  }
  return copy;
}

export interface PatchPaneOptions {
  /** The live widget the engine built for a box, while this patch is playing. */
  widgetFor?(id: string): HTMLElement | undefined;
  /** Open this patch larger, beside its code. */
  onExpand?(): void;
  /**
   * Size the view to the patch, between these heights (px), instead of filling the host:
   * a three-box patch then gets a short view, not a tall empty one.
   */
  fitHeight?: { min: number; max: number; maxLive?: number };
}

/** Room under the patch for the zoom buttons, which sit over the bottom right corner. */
const TOOLS_H = 44;

/** A pannable, zoomable, read-only view of one patch, with its own small toolbar. */
export class PatchPane {
  readonly el: HTMLElement;
  private readonly canvas: HTMLElement;
  private view: PatcherView | null = null;
  private doc: PatchDoc | null = null;
  private ids: string[] = [];
  private touched = false; // after the reader pans or zooms, stop re-fitting on resize
  private readonly resize: ResizeObserver;

  constructor(private readonly host: HTMLElement, private readonly opts: PatchPaneOptions = {}) {
    this.el = document.createElement('div');
    this.el.className = 'ref-patch';
    this.el.innerHTML = `
      <div class="patch-canvas"></div>
      <div class="patch-tools">
        <button data-act="in" title="Zoom in" aria-label="Zoom in">+</button>
        <button data-act="out" title="Zoom out" aria-label="Zoom out">−</button>
        <button data-act="fit" title="Fit the whole patch" aria-label="Fit">⊡</button>
        ${opts.onExpand ? '<button data-act="expand" title="Open larger, beside the code" aria-label="Expand">⤢</button>' : ''}
      </div>`;
    host.appendChild(this.el);
    this.canvas = this.el.querySelector('.patch-canvas')!;

    this.el.querySelector('.patch-tools')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'in') this.zoomBy(1.25);
      else if (act === 'out') this.zoomBy(0.8);
      else if (act === 'fit') { this.touched = false; this.view?.fit(PAD); }
      else if (act === 'expand') this.opts.onExpand?.();
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));

    this.resize = new ResizeObserver(() => { if (!this.touched) this.view?.fit(PAD); });
    this.resize.observe(this.canvas);
  }

  /** Show a patch (maxpat JSON), laid out for reading. */
  show(patch: unknown): void {
    this.view?.destroy();
    const laidOut = layoutForReading(patch);
    this.ids = (laidOut as Patch).patcher.boxes.map((b) => b.box.id);
    this.sizeTo(laidOut);
    this.doc = PatchDoc.fromIR(parseMaxPat(laidOut));
    this.view = new PatcherView(this.canvas, { doc: this.doc, widgetFor: this.opts.widgetFor });
    this.view.setMode('run');
    this.touched = false;
    requestAnimationFrame(() => this.view?.fit(PAD));
  }

  /** With fitHeight, make the host as tall as the patch at full size (fit never enlarges it). */
  private sizeTo(patch: unknown): void {
    const range = this.opts.fitHeight;
    if (!range) return;
    let top = Infinity, bottom = -Infinity;
    for (const { box } of (patch as Patch).patcher.boxes) {
      const r = box.patching_rect;
      if (!r) continue;
      top = Math.min(top, r[1]);
      bottom = Math.max(bottom, r[1] + (r[3] || BOX_H));
    }
    const content = Number.isFinite(top) ? bottom - top : 0;
    const height = Math.min(range.max, Math.max(range.min, content + 2 * PAD + TOOLS_H));
    this.host.style.height = `${Math.round(height)}px`;
  }

  /**
   * Re-mount the engine's widgets, after the patch starts or stops playing. A widget can
   * be much bigger than its box (jit.window's picture), so the view is sized again to
   * the boxes as drawn now, and the whole patch re-fitted into it.
   */
  refreshWidgets(): void {
    const view = this.view;
    if (!view) return;
    view.refreshWidgets();
    const range = this.opts.fitHeight;
    if (range) {
      let top = Infinity, bottom = -Infinity, live = false;
      for (const id of this.ids) {
        const g = view.boxGeom(id);
        if (!g) continue;
        top = Math.min(top, g.y);
        bottom = Math.max(bottom, g.y + g.h);
        if (this.opts.widgetFor?.(id)) live = true;
      }
      const max = live ? (range.maxLive ?? range.max) : range.max;
      const content = Number.isFinite(top) ? bottom - top : 0;
      this.host.style.height = `${Math.round(Math.min(max, Math.max(range.min, content + 2 * PAD + TOOLS_H)))}px`;
    }
    this.touched = false;
    requestAnimationFrame(() => this.view?.fit(PAD));
  }

  destroy(): void {
    this.resize.disconnect();
    this.view?.destroy();
    this.el.remove();
  }

  private zoomBy(f: number, clientX?: number, clientY?: number): void {
    if (!this.view) return;
    this.touched = true;
    const r = this.canvas.getBoundingClientRect();
    const cx = (clientX ?? r.left + r.width / 2) - r.left;
    const cy = (clientY ?? r.top + r.height / 2) - r.top;
    const v = this.view.viewport;
    const zoom = Math.min(4, Math.max(0.15, v.zoom * f));
    const k = zoom / v.zoom; // keep the point under the cursor still
    this.view.setViewport({ x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, zoom });
  }

  private onWheel(e: WheelEvent): void {
    // ⌘/Ctrl + scroll zooms; a trackpad pinch arrives as ctrl + wheel. Plain scrolling
    // scrolls the page, so the patch never traps someone reading down it.
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.view || !this.doc || e.button !== 0) return;
    if ((e.target as Element).closest('foreignObject')) return; // a live widget: let it work
    const view = this.view, doc = this.doc;
    const id = view.hitBox(e.clientX, e.clientY);
    const start = { x: e.clientX, y: e.clientY };
    const vp: Viewport = view.viewport;
    const node = id ? doc.node(id) : undefined;
    const from = node ? ([...node.rect] as typeof node.rect) : null;
    this.touched = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add('dragging');

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (id && from && node) {
        // Move the box: a set-rect op, the same way MaxPyStudio's editor moves one.
        const to = [from[0] + dx / vp.zoom, from[1] + dy / vp.zoom, from[2], from[3]] as typeof from;
        const now = [...doc.node(id)!.rect] as typeof from;
        doc.transact('move', (tx) => tx.apply({ t: 'set-rect', id, from: now, to }));
      } else {
        view.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
      }
    };
    const up = (ev: PointerEvent) => {
      this.canvas.releasePointerCapture(ev.pointerId);
      this.canvas.classList.remove('dragging');
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }
}
