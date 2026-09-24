// src/doc/ops.ts — the op union and its inverse.
//
// One property carries the whole undo system: invert() is an involution. Undo applies
// the inverses of a recorded entry and pushes the ORIGINAL entry onto the redo stack, so
// undo-redo-undo re-derives the inverse each time. If invert() lost a field on the way
// round — an edge's midpoints, a rect's width, the direction of a renumber — the second
// undo would restore something subtly different from the first, and nothing else in the
// system would notice. So every variant is checked both ways, and the list of variants
// is checked against the union itself so a future op cannot be added without landing
// here.
//
// The other thing pinned here is that doc/ops does not own cord identity: edgeKey comes
// from engine/engine, and the document and the engine must key a cord identically or an
// incremental disconnect in Phase 5 would look up a string the engine never stored.

import { describe, expect, it } from 'vitest';
import { edgeKey as engineEdgeKey } from '../src/engine/engine';
import { edgeKey, invert, type Op } from '../src/doc/ops';
import type { IREdge, IRNode } from '../src/ir/types';

function node(id: string, text: string): IRNode {
  return {
    id,
    className: text.split(' ')[0],
    args: [440],
    maxclass: 'newobj',
    numInlets: 2,
    numOutlets: 1,
    outletDomains: ['signal'],
    rect: [10, 20, 60, 22],
    text,
    outletTypes: ['signal'],
    attrs: {},
    known: true,
    raw: { maxclass: 'newobj', text, bgcolor: [1, 0, 0, 1] },
  };
}

const cord: IREdge = {
  from: { id: 'obj-1', outlet: 0 },
  to: { id: 'obj-2', inlet: 1 },
  domain: 'signal',
  midpoints: [12, 34, 56, 78],
};

/** One op of every variant in the union, by tag. */
const SAMPLES: { [K in Op['t']]: Extract<Op, { t: K }> } = {
  'add-node': { t: 'add-node', node: node('obj-1', 'cycle~ 440') },
  'remove-node': { t: 'remove-node', node: node('obj-2', '*~ 0.2') },
  'set-rect': { t: 'set-rect', id: 'obj-3', from: [0, 0, 40, 22], to: [80, 120, 40, 22] },
  'set-box': {
    t: 'set-box',
    id: 'obj-4',
    from: node('obj-4', 'unpack 1 2 3'),
    to: node('obj-4', 'unpack 1 2'),
  },
  'add-edge': { t: 'add-edge', edge: cord },
  'remove-edge': { t: 'remove-edge', edge: cord },
  'renumber': {
    t: 'renumber',
    map: { 'obj-9': 'obj-1', 'obj-4': 'obj-2', 'obj-7': 'obj-3' },
    edgeMap: { 'obj-9:0>obj-4:1': 'obj-1:0>obj-2:1' },
  },
  'sub': {
    t: 'sub',
    id: 'obj-5',
    from: node('obj-5', 'p inner'),
    to: node('obj-5', 'p inner'),
    ops: [
      { t: 'add-node', node: node('obj-1', 'cycle~ 440') },
      { t: 'set-rect', id: 'obj-1', from: [0, 0, 40, 22], to: [8, 8, 40, 22] },
    ],
  },
};

const ALL = Object.values(SAMPLES) as Op[];

describe('invert', () => {
  it('covers every variant of the Op union', () => {
    // Op['t'] drives the SAMPLES type, so a new variant fails to compile above; this
    // guards the other direction — that the sample table wasn't quietly shortened.
    expect(ALL.map((op) => op.t).sort()).toEqual(
      ['add-edge', 'add-node', 'remove-edge', 'remove-node', 'renumber', 'set-box', 'set-rect', 'sub'],
    );
  });

  it('is an involution for every variant', () => {
    for (const op of ALL) {
      expect(invert(invert(op)), `invert(invert(${op.t}))`).toEqual(op);
    }
  });

  it('does not mutate the op it inverts', () => {
    for (const op of ALL) {
      const before = structuredClone(op);
      invert(op);
      expect(op).toEqual(before);
    }
  });

  it('turns add into remove and back, carrying the whole payload', () => {
    // The payload is what makes an op self-sufficient: undoing a delete has to restore
    // the box's `raw` Max attributes, not just its class and position.
    expect(invert(SAMPLES['add-node'])).toEqual({
      t: 'remove-node',
      node: SAMPLES['add-node'].node,
    });
    expect(invert(SAMPLES['remove-node'])).toEqual({
      t: 'add-node',
      node: SAMPLES['remove-node'].node,
    });
    expect(invert(SAMPLES['add-edge'])).toEqual({ t: 'remove-edge', edge: cord });
    expect(invert(SAMPLES['remove-edge'])).toEqual({ t: 'add-edge', edge: cord });
  });

  it('swaps from and to for the two replacing ops', () => {
    expect(invert(SAMPLES['set-rect'])).toEqual({
      t: 'set-rect',
      id: 'obj-3',
      from: [80, 120, 40, 22],
      to: [0, 0, 40, 22],
    });
    const box = invert(SAMPLES['set-box']);
    expect(box.t).toBe('set-box');
    if (box.t !== 'set-box') return;
    expect(box.from.text).toBe('unpack 1 2');
    expect(box.to.text).toBe('unpack 1 2 3');
  });

  it('reverses BOTH of a renumber’s maps', () => {
    // The cord map is not derivable from the node map without re-parsing the edgeKey
    // format, which is the second definition of cord identity this module refuses to
    // have. So it has to survive inversion on its own, or an engine remapping its
    // `Map<edgeKey, teardown>` would follow the right ids in one direction only.
    expect(invert(SAMPLES['renumber'])).toEqual({
      t: 'renumber',
      map: { 'obj-1': 'obj-9', 'obj-2': 'obj-4', 'obj-3': 'obj-7' },
      edgeMap: { 'obj-1:0>obj-2:1': 'obj-9:0>obj-4:1' },
    });
  });
});

describe('invert: sub', () => {
  it('swaps the box and undoes the inner edit in reverse order', () => {
    const inv = invert(SAMPLES['sub']);
    expect(inv.t).toBe('sub');
    if (inv.t !== 'sub') return;
    expect(inv.from).toBe(SAMPLES['sub'].to);
    expect(inv.to).toBe(SAMPLES['sub'].from);
    // Exactly what an undo entry of the inner document would replay: the move comes
    // back first, then the box goes away.
    expect(inv.ops.map((op) => op.t)).toEqual(['set-rect', 'remove-node']);
  });
});

describe('edgeKey', () => {
  it('is the engine function itself, not a copy of its format', () => {
    // A second definition that drifted by one character would leave the document and the
    // engine keying the same cord differently, and an incremental disconnect would miss.
    expect(edgeKey).toBe(engineEdgeKey);
  });

  it('distinguishes ports, not just boxes', () => {
    const other: IREdge = { ...cord, from: { id: 'obj-1', outlet: 1 } };
    expect(edgeKey(other)).not.toBe(edgeKey(cord));
    expect(edgeKey({ ...cord, midpoints: undefined })).toBe(edgeKey(cord));
  });
});
