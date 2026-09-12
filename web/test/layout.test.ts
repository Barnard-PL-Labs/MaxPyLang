// Geometry tests for ui/layout.ts.
//
// layout.ts was carved out of ui/graph.ts as a pure refactor, so the first duty of this
// file is to pin the numbers: every expectation below was derived by hand from the
// pre-refactor renderer, not from the new code. The second is to cover what the split
// actually changed — layout() no longer moves the origin, and normalizeOrigin() survives
// a patch with no boxes (Math.min() of nothing is Infinity, which used to reach the SVG
// as a NaN width) — plus the port hit areas the patcher will grab cords from.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMaxPat } from '../src/parser/maxpat';
import type { Domain, IRNode, IRPatch } from '../src/ir/types';
import {
  boxSize, cordPath, inletPoint, layout, nodeDomain, normalizeOrigin, outletPoint,
  portHitRect, portNubRect, portX, textWidth, type LaidBox,
} from '../src/ui/layout';

const PATCHES = [
  'arpeggiator', 'detune_drone', 'detuned_chord', 'fm_synth', 'hello_world',
  'interactive_synth', 'overdrive', 'random_melody', 'ring_mod', 'subtractive_synth',
  'theremin', 'tremolo', 'webcam_pixelated_synth', 'webcam_theremin',
];

function loadPatch(name: string): IRPatch {
  const path = fileURLToPath(new URL(`../public/test-patches/${name}.maxpat`, import.meta.url));
  return parseMaxPat(JSON.parse(readFileSync(path, 'utf-8')));
}

function mkNode(over: Partial<IRNode> & { id: string }): IRNode {
  return {
    className: 'print', args: [], maxclass: 'newobj', numInlets: 1, numOutlets: 0,
    outletDomains: [], rect: [0, 0, 0, 0], text: '', ...over,
  };
}

function mkPatch(nodes: IRNode[]): IRPatch {
  return { nodes, edges: [], byId: new Map(nodes.map((n) => [n.id, n])) };
}

/** A single box placed where the caller says, sized as the renderer would size it. */
function boxAt(x: number, y: number, node: IRNode): LaidBox {
  const [w, h] = boxSize(node);
  return { x, y, w, h, node, authoredRect: node.rect };
}

describe('portX', () => {
  // Max's rule: port 0 flush LEFT, the last port flush RIGHT, each centre one
  // half-target (8px) in from the edge so its whole grab area lands on the box.
  //   edge = min(8, w/2) -> x + edge + (w - 2*edge) * i / (count - 1)
  // Box at x=100, w=80: edge 8, span 64, so ports run 108..172.
  it('puts a lone port in the corner, as Max does — not in the middle of the edge', () => {
    expect(portX(100, 80, 0, 1)).toBe(108);
    expect(portX(100, 80, 0, 0)).toBe(108); // a box with no ports never asks, but don't NaN
    // The failure this pins: a centred lone outlet is what a cord released on the BODY
    // of a box hits first, which is how the middle of every box became a dead zone.
    expect(portX(100, 80, 0, 1)).not.toBe(140);
  });

  it('puts the two ports of a 2-port box flush with its two edges', () => {
    expect(portX(100, 80, 0, 2)).toBe(108);
    expect(portX(100, 80, 1, 2)).toBe(172);
  });

  it('spreads five ports evenly between the flush first and last', () => {
    const xs = [0, 1, 2, 3, 4].map((i) => portX(100, 80, i, 5));
    expect(xs).toEqual([108, 124, 140, 156, 172]);
  });

  it('collapses the edge offset on a box too narrow for two targets', () => {
    // w=24 -> edge 8 (< w/2 = 12), span 8.
    expect([0, 1, 2].map((i) => portX(100, 24, i, 3))).toEqual([108, 112, 116]);
    // w=10 -> edge 5, so both ports still land ON the box rather than crossing over.
    expect([0, 1].map((i) => portX(100, 10, i, 2))).toEqual([105, 105]);
  });
});

describe('port hit areas', () => {
  // `t b b b b` is the stress case: 9 characters -> ceil(9*6.7) + 18 = 79px wide,
  // 5 outlets, so the pitch is 14.75px.
  const trig = mkNode({ id: 'obj-1', className: 't', text: 't b b b b', numOutlets: 5 });
  const box = boxAt(40, 60, trig);
  const rects = [0, 1, 2, 3, 4].map((i) => portHitRect(box, 'outlet', i, 5));

  it('sizes the box from its text', () => {
    expect(box.w).toBe(79);
    expect(box.h).toBe(26);
  });

  it('keeps every outlet target at least 9px wide', () => {
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(9);
      expect(r.width).toBeCloseTo(13.8, 10); // clamp(79/5 - 2, 9, 16)
    }
  });

  it('never overlaps neighbouring outlets on a 5-outlet box', () => {
    for (let i = 0; i < rects.length - 1; i++) {
      expect(rects[i].x + rects[i].width).toBeLessThanOrEqual(rects[i + 1].x + 1e-9);
    }
  });

  it('straddles the box edge so a click just outside still lands', () => {
    const bottom = box.y + box.h;
    for (const r of rects) {
      expect(r.y).toBeLessThan(bottom);
      expect(r.y + r.height).toBeGreaterThan(bottom);
    }
    const top = portHitRect(box, 'inlet', 0, 1);
    expect(top.y).toBeLessThan(box.y);
    expect(top.y + top.height).toBeGreaterThan(box.y);
  });

  it('draws each nub inside both its hit area and the box', () => {
    for (let i = 0; i < 5; i++) {
      const hit = rects[i];
      const nub = portNubRect(box, 'outlet', i, 5);
      expect(nub.x).toBeGreaterThanOrEqual(hit.x);
      expect(nub.x + nub.width).toBeLessThanOrEqual(hit.x + hit.width);
      expect(nub.y).toBeGreaterThanOrEqual(hit.y);
      expect(nub.y + nub.height).toBeLessThanOrEqual(hit.y + hit.height);
      // wholly inside the box body, so it reads as part of the box
      expect(nub.y).toBeGreaterThanOrEqual(box.y);
      expect(nub.y + nub.height).toBeLessThanOrEqual(box.y + box.h);
    }
  });
});

describe('cord endpoints and path', () => {
  const n = mkNode({ id: 'obj-1', className: '*~', text: '*~ 0.2', numInlets: 2, numOutlets: 1 });
  const box = boxAt(0, 0, n); // w = 59, h = 26

  it('anchors inlets to the top edge and outlets to the bottom', () => {
    expect(inletPoint(box, 0)).toEqual({ x: portX(0, 59, 0, 2), y: 0 });
    expect(inletPoint(box, 1).y).toBe(0);
    expect(outletPoint(box, 0)).toEqual({ x: 8, y: 26 }); // lone outlet: Max's bottom-left corner
  });

  it('bulges by 40% of the drop', () => {
    expect(cordPath({ x: 10, y: 20 }, { x: 60, y: 120 })).toBe('M 10 20 C 10 60, 60 80, 60 120');
  });

  it('keeps an 18px bulge on a short hop', () => {
    expect(cordPath({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('M 0 0 C 0 18, 0 -8, 0 10');
  });
});

describe('nodeDomain', () => {
  const of = (outletDomains: Domain[]) =>
    nodeDomain(mkNode({ id: 'obj-1', outletDomains, numOutlets: outletDomains.length }));

  it('classifies by primary output domain', () => {
    expect(of(['signal'])).toBe('signal');
    expect(of(['control', 'signal'])).toBe('signal'); // any signal outlet wins
    expect(of(['video'])).toBe('video');
    expect(of(['control', 'video'])).toBe('video');
    expect(of(['control'])).toBe('control');
    expect(of([])).toBe('sink'); // ezdac~, jit.window, print
  });

  it('ranks signal above video when a node emits both', () => {
    expect(of(['video', 'signal'])).toBe('signal');
  });
});

describe('boxSize', () => {
  it('sizes a plain box from its text, ignoring the authored width', () => {
    const n = mkNode({ id: 'obj-1', className: 'gate', text: 'gate 2', rect: [0, 0, 300, 12] });
    expect(boxSize(n)).toEqual([textWidth('gate 2') + 18, 26]);
    expect(boxSize(n)[0]).toBe(59);
  });

  it('has a floor so a one-character box stays hittable', () => {
    expect(boxSize(mkNode({ id: 'obj-1', className: 't', text: 't' }))[0]).toBe(38);
  });

  it('gives a known widget its usable on-screen size', () => {
    const n = mkNode({ id: 'obj-1', className: 'slider', maxclass: 'slider', rect: [0, 0, 20, 140] });
    expect(boxSize(n, {} as HTMLElement)).toEqual([136, 24]);
  });

  it('falls back to the authored rect (with minimums) for an unknown widget', () => {
    const n = mkNode({ id: 'obj-1', className: 'fpic', maxclass: 'fpic', rect: [0, 0, 20, 15] });
    expect(boxSize(n, {} as HTMLElement)).toEqual([90, 24]);
  });
});

describe('layout', () => {
  it('places boxes in true patch coordinates, with no origin shift', () => {
    const patch = mkPatch([mkNode({ id: 'obj-1', text: 'cycle~ 440', rect: [140, 200, 100, 22] })]);
    const b = layout(patch).get('obj-1')!;
    // The whole point of the split: the patcher needs screen->patch to be one affine
    // transform, which it isn't if rendering re-centres the patch.
    expect([b.x, b.y]).toEqual([140, 200]);
  });

  it('carries the authored rect through without aliasing the IR node', () => {
    const n = mkNode({ id: 'obj-1', text: 'cycle~ 440', rect: [140, 200, 100, 22] });
    const b = layout(mkPatch([n])).get('obj-1')!;
    expect(b.authoredRect).toEqual([140, 200, 100, 22]);
    expect(b.w).not.toBe(100); // rendered width is text-derived, not the authored one
    b.authoredRect[0] = 999;
    expect(n.rect[0]).toBe(140);
  });
});

describe('normalizeOrigin', () => {
  it('returns a finite canvas for an empty patch', () => {
    // The bug this replaced: Math.min(...[]) is Infinity, so width/height came out NaN
    // and the <svg> collapsed — exactly what a brand-new empty patch produces.
    const dims = normalizeOrigin(layout(mkPatch([])).values(), 28);
    expect(Number.isFinite(dims.width)).toBe(true);
    expect(Number.isFinite(dims.height)).toBe(true);
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
    expect(dims).toEqual({ width: 320, height: 180 });
  });

  it('shifts a 3-box patch to the padded origin and sizes the canvas around it', () => {
    const patch = mkPatch([
      mkNode({ id: 'obj-1', text: 'cycle~ 440', rect: [140, 200, 0, 0] }), // w 85
      mkNode({ id: 'obj-2', text: '*~ 0.2', rect: [60, 320, 0, 0] }),      // w 59
      mkNode({ id: 'obj-3', text: 'ezdac~', rect: [300, 80, 0, 0] }),      // w 59
    ]);
    const boxes = layout(patch);
    // min corner is (60, 80), so everything moves by (28-60, 28-80) = (-32, -52).
    const dims = normalizeOrigin(boxes.values(), 28);

    expect([boxes.get('obj-1')!.x, boxes.get('obj-1')!.y]).toEqual([108, 148]);
    expect([boxes.get('obj-2')!.x, boxes.get('obj-2')!.y]).toEqual([28, 268]);
    expect([boxes.get('obj-3')!.x, boxes.get('obj-3')!.y]).toEqual([268, 28]);
    // widest right edge 268+59=327, lowest bottom 268+26=294, each plus the pad
    expect(dims).toEqual({ width: 355, height: 322 });
  });

  it('leaves the top-left box at exactly (pad, pad) for every bundled patch', () => {
    for (const name of PATCHES) {
      const boxes = [...layout(loadPatch(name)).values()];
      normalizeOrigin(boxes, 28);
      expect(Math.min(...boxes.map((b) => b.x)), name).toBe(28);
      expect(Math.min(...boxes.map((b) => b.y)), name).toBe(28);
    }
  });
});

// ---------------------------------------------------------------------------------
// Refactor parity: the pre-refactor renderer, transcribed from ui/graph.ts as it stood
// before the split, so the picture the player draws can be checked against something
// that is not the code under test.
//
// BOX GEOMETRY IS FROZEN and always was: Phase 3 was a pure refactor and must not move
// a box or resize the canvas by a pixel, so `rects` and the canvas dimensions are still
// compared against the legacy renderer verbatim.
//
// PORT PLACEMENT DELIBERATELY CHANGED, once, in the adversarial-review pass: ports now
// follow Max's rule (port 0 flush left, the last port flush right) instead of being
// centred and inset by min(10, w/4). So the cord assertion below is not "identical" but
// something stricter than a snapshot would be — the paths must equal the SAME legacy
// renderer driven by the new port rule, and every cord's Y coordinates must still match
// the old picture exactly, which is what says the change moved port x and nothing else.
// ---------------------------------------------------------------------------------

type PortRule = (b: { x: number; w: number }, index: number, count: number) => number;

/** ui/graph.ts's port rule as it stood before the review pass: centred, inset by w/4. */
const legacyPortX: PortRule = (b, index, count) => {
  if (count <= 1) return b.x + b.w / 2;
  const inset = Math.min(10, b.w / 4);
  return b.x + inset + ((b.w - 2 * inset) * index) / (count - 1);
};

/** Max's rule, transcribed independently of ui/layout.ts: flush left, flush right. */
const flushPortX: PortRule = (b, index, count) => {
  const edge = Math.min(8, b.w / 2);
  if (count <= 1) return b.x + edge;
  return b.x + edge + ((b.w - 2 * edge) * index) / (count - 1);
};

function legacyRender(patch: IRPatch, portRule: PortRule) {
  const legacyTextWidth = (s: string) => Math.ceil(s.length * 6.7);
  const boxes = new Map<string, { x: number; y: number; w: number; h: number; node: IRNode }>();
  for (const n of patch.nodes) {
    const w = Math.max(legacyTextWidth(n.text || n.className) + 18, 38);
    boxes.set(n.id, { x: n.rect[0], y: n.rect[1], w, h: 26, node: n });
  }
  const pad = 28;
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  for (const b of boxes.values()) { b.x += pad - minX; b.y += pad - minY; }
  const width = Math.max(...all.map((b) => b.x + b.w)) + pad;
  const height = Math.max(...all.map((b) => b.y + b.h)) + pad;

  const cords: string[] = [];
  for (const e of patch.edges) {
    const src = boxes.get(e.from.id);
    const dst = boxes.get(e.to.id);
    if (!src || !dst) continue;
    const x1 = portRule(src, e.from.outlet, src.node.numOutlets);
    const y1 = src.y + src.h;
    const x2 = portRule(dst, e.to.inlet, dst.node.numInlets);
    const y2 = dst.y;
    const dy = Math.max(18, Math.abs(y2 - y1) * 0.4);
    cords.push(`M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`);
  }
  return { rects: all.map((b) => [b.x, b.y, b.w, b.h]), width, height, cords };
}

/** The four Y coordinates of a cord path — everything the port rule must NOT touch. */
const ysOf = (path: string): number[] =>
  (path.match(/-?[\d.]+/g) ?? []).filter((_, i) => i % 2 === 1).map(Number);

describe('parity with the pre-refactor renderer', () => {
  it.each(PATCHES)('lays out %s identically', (name) => {
    const patch = loadPatch(name);
    const legacy = legacyRender(patch, legacyPortX);
    const flush = legacyRender(patch, flushPortX);

    const boxes = layout(patch);
    const dims = normalizeOrigin(boxes.values(), 28);
    const rects = [...boxes.values()].map((b) => [b.x, b.y, b.w, b.h]);
    const cords = patch.edges.flatMap((e) => {
      const src = boxes.get(e.from.id);
      const dst = boxes.get(e.to.id);
      if (!src || !dst) return [];
      return [cordPath(outletPoint(src, e.from.outlet), inletPoint(dst, e.to.inlet))];
    });

    // Frozen: a box's size and position, and the canvas that holds them.
    expect(rects).toEqual(legacy.rects);
    expect(dims).toEqual({ width: legacy.width, height: legacy.height });
    // Changed on purpose, and in exactly one dimension: cords attach where Max attaches
    // them, and every Y in the picture is still the Y the player drew before.
    expect(cords).toEqual(flush.cords);
    expect(cords.map(ysOf)).toEqual(legacy.cords.map(ysOf));
    expect(cords.length).toBeGreaterThan(0);
  });

  it('the port rule really did move, so the parity above is not vacuous', () => {
    // hello_world is cycle~ -> *~ -> ezdac~: single-outlet boxes whose cord used to
    // leave from the middle of the bottom edge and now leaves from the corner.
    const patch = loadPatch('hello_world');
    expect(legacyRender(patch, flushPortX).cords).not.toEqual(
      legacyRender(patch, legacyPortX).cords,
    );
  });
});
