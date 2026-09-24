// Pure geometry for a patch canvas: where each box sits, how big it is, where its
// ports are, and the shape of a cord between two of them. Split out of ui/graph.ts so
// the read-only player and the editable patcher derive identical coordinates from one
// source, and so the arithmetic is unit-testable with no DOM in sight.
//
// Two contracts the patcher leans on:
//   • layout() works in TRUE patch coordinates and never shifts the origin. Moving the
//     whole patch so its top-left box lands at a padding offset is normalizeOrigin(),
//     which only the player's fixed-size canvas calls. If layout() kept re-centring,
//     deleting the top-left box would appear to move every *other* box, and screen->patch
//     would stop being a single affine transform.
//   • the port helpers take scalars (x, w, index, count), not a box, because a cord drag
//     asks for a port position on every pointermove and must not allocate to do it.

import type { IRNode, IRPatch } from '../ir/types';

/**
 * Fallback domain colours: the dark theme's values, used when there is no document to
 * read a theme from (the headless test suite) or before the stylesheet has applied.
 * Prefer domainColor() — these are the floor, not the source of truth.
 */
export const DOMAIN_COLOR: Record<string, string> = {
  signal: '#e8b73e', // amber — audio, like Max signal cords
  control: '#5aa9e6', // blue — control/message
  video: '#a882e6', // purple — jitter
};

/**
 * The live colour of a domain, read from the theme.
 *
 * Most of the canvas is painted by CSS rules in ui/patcher.css, which outrank the
 * presentation attributes the renderer writes and therefore follow a theme switch for
 * free. Two things cannot work that way: the rubber cord and the marquee are drawn by the
 * gesture code, which owns their stroke because it encodes a VERDICT (refused is red and
 * dashed, warned is dashed in its own domain colour) that CSS has no way to know. Those
 * read their colour from here instead, so a light theme's darker amber reaches them too.
 *
 * Values are read per call and not cached: this runs a handful of times per gesture, and
 * a cache would have to be invalidated on a theme switch — a bug waiting to happen for
 * no measurable gain.
 */
export function domainColor(domain: string): string {
  const fallback = FALLBACK_COLOR[domain] ?? NEUTRAL_COLOR;
  if (typeof document === 'undefined' || !document.documentElement) return fallback;
  const token = domain === 'err' ? '--err' : `--${domain}`;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

/** The colour of a port that has no domain of its own — an inlet, or an unknown box. */
export const NEUTRAL_COLOR = '#7a828c';

/**
 * Fallbacks for every token domainColor() can be asked for, not just the three cord
 * domains: 'err' paints a refused cord and has no entry in DOMAIN_COLOR, and falling
 * through to neutral grey would make a refusal look like an ordinary inlet.
 */
const FALLBACK_COLOR: Record<string, string> = {
  ...DOMAIN_COLOR,
  err: '#e8736b',
  neutral: NEUTRAL_COLOR,
};

// Usable on-screen sizes for interactive widgets (their Max box is far too small).
export const WIDGET_SIZE: Record<string, [number, number]> = {
  slider: [136, 24], dial: [50, 50], rslider: [136, 34], kslider: [176, 46],
  nslider: [76, 34], incdec: [28, 36], number: [60, 24], flonum: [66, 24],
  'number~': [66, 24], toggle: [26, 26], button: [26, 26], bng: [26, 26],
  led: [20, 20], umenu: [130, 26], tab: [150, 28], matrixctrl: [128, 128],
  multislider: [150, 64], comment: [130, 22], panel: [90, 64],
};

/**
 * Widgets that render their own text, so a renderer must NOT also caption them.
 *
 * Every other mounted widget is a bare control — a slider says nothing about what it
 * does — so both renderers write the box text above it. These two already show it, and
 * captioning them prints it twice, once above the box and once inside it.
 */
export const SELF_LABELLED = new Set(['message', 'comment']);

/** Gap between the outermost boxes and the edge of the player's canvas. */
export const GRAPH_PAD = 28;

/** Canvas the player falls back to when the patch has no boxes at all. */
const EMPTY_CANVAS_W = 320;
const EMPTY_CANVAS_H = 180;

/** A port's grab area straddles the box edge, so a click just outside still lands. */
const PORT_HIT_H = 10;
/**
 * How far a port's CENTRE sits in from the box edge — half the widest a grab area ever
 * gets (see portHitRect's clamp), so the leftmost port's target is flush with the left
 * edge of the box and wholly on it. This is what makes inlet 0 / outlet 0 sit in Max's
 * corner rather than floating somewhere in the middle of the edge.
 */
const PORT_EDGE = 8;
/** The visible nub sits wholly inside the box, centred in its grab area. */
const PORT_NUB_H = 3;

export type PortDir = 'inlet' | 'outlet';

export interface Point { x: number; y: number }

export interface Rect { x: number; y: number; width: number; height: number }

/** A node placed on the canvas. `x/y` are live (normalizeOrigin rewrites them). */
export interface LaidBox {
  x: number; y: number; w: number; h: number;
  node: IRNode;
  widget?: HTMLElement;
  /**
   * The box's authored `patching_rect`, carried through untouched. `w/h` above are the
   * *rendered* size, which for a plain object box is derived from its text — see boxSize.
   */
  authoredRect: [number, number, number, number];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** ~monospace 11px advance. */
export const textWidth = (s: string) => Math.ceil(s.length * 6.7);

/** Which colour to accent a node by (its primary output domain). */
export function nodeDomain(n: IRNode): 'signal' | 'control' | 'video' | 'sink' {
  if (n.outletDomains.includes('signal')) return 'signal';
  if (n.outletDomains.includes('video')) return 'video';
  if (n.numOutlets === 0) return 'sink';
  return 'control';
}

/**
 * Rendered size of a box. A plain object box is sized from its TEXT and deliberately
 * ignores the authored `patching_rect` width: Max saved that width against a font we
 * don't have, so honouring it clips or pads at random. A mounted widget instead gets a
 * size that is actually usable with a mouse, which its 20x15 Max box never is.
 *
 * An editor that must write geometry back to .maxpat should read `LaidBox.authoredRect`
 * rather than this, so a round trip doesn't silently resize every box in the patch.
 */
export function boxSize(node: IRNode, widget?: HTMLElement): [number, number] {
  const fromText = (): [number, number] => [
    Math.max(textWidth(node.text || node.className) + 18, 38),
    26,
  ];
  if (!widget) return fromText();
  // A message box IS its text, and its widget is a clickable skin over that text rather
  // than a control. WIDGET_SIZE has no entry for it and must not grow one: a fixed width
  // would make every `1 2 3` as wide as the longest message in the patch.
  if (node.className === 'message') return fromText();
  // A radiogroup's saved rect IS its layout — `offset` px per button — so it is drawn at
  // exactly that size; stretching it to a minimum width leaves a wide empty panel.
  if (node.className === 'radiogroup') return [Math.max(node.rect[2], 18), Math.max(node.rect[3], 18)];
  // A comment wraps to the width it was saved at, over as many lines as it was saved with.
  // Never shorter than its text needs, since a retyped comment comes back one line high:
  // ~6.2px per character of 12px Arial, 15.6px per line, as .max-comment sets it.
  if (node.className === 'comment' && node.rect[2] > 0) {
    const w = Math.max(node.rect[2], 20);
    const perLine = Math.max(1, Math.floor((w - 8) / 6.2));
    const prose = node.text.replace(/^comment(\s+|$)/, '');
    const lines = prose.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    return [w, Math.max(node.rect[3], 20, Math.ceil(lines * 15.6 + 4))];
  }
  const known = WIDGET_SIZE[node.className];
  if (known) return known;
  if (typeof HTMLCanvasElement !== 'undefined' && widget instanceof HTMLCanvasElement) {
    return [Math.max(widget.width, 48), Math.max(widget.height, 36)];
  }
  return [Math.max(node.rect[2], 90), Math.max(node.rect[3], 24)];
}

/**
 * Port centre x on a box edge, spread across the width. Scalar args: the patcher calls
 * this once per port per pointermove while drafting a cord.
 *
 * MAX'S RULE, not a centred one: port 0 is flush with the LEFT edge and the last port
 * is flush with the RIGHT edge, so a single-outlet object's cord leaves from its
 * bottom-left corner. That is the position a Max user aims at without thinking, and it
 * is also what keeps the middle of a box clear: a lone outlet parked in the centre of
 * its own bottom edge is the first thing a downward hit-test probe finds when a cord is
 * released on the body of a box, which used to swallow the drop.
 *
 * `edge` collapses toward w/2 on a box too narrow to hold two targets, so a degenerate
 * box still yields a point on itself rather than two that cross over.
 */
export function portX(x: number, w: number, index: number, count: number): number {
  const edge = Math.min(PORT_EDGE, w / 2);
  if (count <= 1) return x + edge;
  return x + edge + ((w - 2 * edge) * index) / (count - 1);
}

/** Where a cord into inlet `i` terminates: the top edge of the box. */
export function inletPoint(b: LaidBox, i: number): Point {
  return { x: portX(b.x, b.w, i, b.node.numInlets), y: b.y };
}

/** Where a cord out of outlet `i` starts: the bottom edge of the box. */
export function outletPoint(b: LaidBox, i: number): Point {
  return { x: portX(b.x, b.w, i, b.node.numOutlets), y: b.y + b.h };
}

/**
 * The clickable area of one port. Width follows the port pitch, but never narrower than
 * 9px — on a dense box like `t b b b b` the exact pitch would be unhittable, and a
 * little overlap between neighbours beats a target nobody can grab. `count` is passed in
 * rather than read off the node so an editor can hit-test against a pending arity.
 */
export function portHitRect(b: LaidBox, dir: PortDir, index: number, count: number): Rect {
  const width = clamp(b.w / count - 2, 9, 16);
  const edgeY = dir === 'inlet' ? b.y : b.y + b.h;
  return {
    x: portX(b.x, b.w, index, count) - width / 2,
    y: edgeY - PORT_HIT_H / 2,
    width,
    height: PORT_HIT_H,
  };
}

/** The drawn nub for a port: always strictly inside its own hit rect, and inside the box. */
export function portNubRect(b: LaidBox, dir: PortDir, index: number, count: number): Rect {
  const width = clamp(b.w / count - 4, 7, 14);
  return {
    x: portX(b.x, b.w, index, count) - width / 2,
    y: dir === 'inlet' ? b.y : b.y + b.h - PORT_NUB_H,
    width,
    height: PORT_NUB_H,
  };
}

/**
 * The cord between two port points: a cubic whose control points leave vertically, with
 * an 18px floor on the bulge so a short hop still reads as a curve rather than a kink.
 */
export function cordPath(a: Point, b: Point): string {
  const dy = Math.max(18, Math.abs(b.y - a.y) * 0.4);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
}

/**
 * Place every node of a patch, keyed by node id, in patch coordinates. `widgets` maps a
 * node id to the DOM element the engine built for it, when one exists — a widget changes
 * only the box's size here; mounting it is the renderer's job.
 */
export function layout(
  patch: IRPatch,
  widgets?: ReadonlyMap<string, HTMLElement>
): Map<string, LaidBox> {
  const boxes = new Map<string, LaidBox>();
  for (const n of patch.nodes) {
    const widget = widgets?.get(n.id);
    const [w, h] = boxSize(n, widget);
    boxes.set(n.id, { x: n.rect[0], y: n.rect[1], w, h, node: n, widget, authoredRect: [...n.rect] });
  }
  return boxes;
}

/**
 * Shift a laid-out patch so its top-left box sits at (pad, pad), and report the canvas
 * that then contains it. Mutates the boxes in place — this is the player's one-shot
 * framing step, not something an editor should ever run mid-session.
 */
export function normalizeOrigin(
  boxes: Iterable<LaidBox>,
  pad: number = GRAPH_PAD
): { width: number; height: number } {
  const all = [...boxes];
  // An empty patch has no extrema: Math.min() of nothing is Infinity, which used to
  // propagate into NaN width/height the moment a patch with zero boxes was rendered.
  if (all.length === 0) {
    return { width: Math.max(EMPTY_CANVAS_W, 2 * pad), height: Math.max(EMPTY_CANVAS_H, 2 * pad) };
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const b of all) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
  }

  let width = 0;
  let height = 0;
  for (const b of all) {
    b.x += pad - minX;
    b.y += pad - minY;
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  return { width: width + pad, height: height + pad };
}
