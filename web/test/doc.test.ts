// src/doc/patch-doc.ts — the mutable patch document.
//
// The document is the one thing the canvas, the engine, the inspector and the writer all
// trust, so what is tested here is not "does addBox add a box" but the four properties
// everything downstream is allowed to assume:
//
//   • every edit round-trips. Undo then redo has to land on a document that is EQUAL,
//     not merely equivalent — compared through toIR() with nothing normalized away,
//     because the writer serializes exactly what toIR() returns, box order and Max-only
//     `raw` keys included.
//   • an edit and its consequences are one transaction. Deleting a box takes its cords
//     with it and shrinking a box's arity takes the orphaned cords with it, each under a
//     single Cmd-Z; anything else would let the document and the engine disagree about a
//     cord that cannot exist.
//   • ids are minted, never recycled — the undo stack is full of ops that name ids.
//   • the change feed is per transaction, not per op, and says where it came from. Phase
//     5's engine applies these lists incrementally; a listener that fired four times for
//     one delete would tear down and rebuild four times.
//
// Headless (Node): the document is pure data, so none of this needs a DOM or an
// AudioContext. It does need generated/boxspecs.json for real arity, which is what the
// async PatchDoc.create()/open() factories exist to wait for — and the last test here
// pins what happens to a caller who skips them.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PatchDoc, type DocSource } from '../src/doc/patch-doc';
import { edgeKey as engineEdgeKey } from '../src/engine/engine';
import { loadBoxSpecs } from '../src/ir/objectspec';
import { parseMaxPat } from '../src/parser/maxpat';
import { EMPTY_PATCHER_HEADER, nodeToBox } from '../src/parser/write-maxpat';
import type { Op } from '../src/doc/ops';
import type { IRNode, IRPatch } from '../src/ir/types';

/** One of the repo's real .maxpat files, parsed. Paths are relative to the repo root. */
function load(rel: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8'));
}

// Same guard as objectspec.test.ts: the generated table is committed, but a fresh
// checkout that hasn't run `npm run gen:manifest` should skip rather than fail, and
// skipIf is evaluated at collection time so it has to be a file check.
const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

/** cycle~ -> *~ -> ezdac~ (both channels): three boxes, three cords, one signal chain. */
async function chain() {
  const doc = await PatchDoc.create({ rect: [0, 0, 800, 600] });
  const osc = doc.addBox('cycle~ 440', 20, 20);
  const amp = doc.addBox('*~ 0.2', 20, 70);
  const dac = doc.addBox('ezdac~', 20, 120);
  doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });
  doc.addEdge({ id: amp.id, outlet: 0 }, { id: dac.id, inlet: 0 });
  doc.addEdge({ id: amp.id, outlet: 0 }, { id: dac.id, inlet: 1 });
  return { doc, osc, amp, dac };
}

/** Records every notification, flattened to something an assertion can read. */
function record(doc: PatchDoc) {
  const calls: { source: DocSource; tags: Op['t'][]; ops: Op[] }[] = [];
  const off = doc.on((ops, source) => {
    calls.push({ source, tags: ops.map((o) => o.t), ops: [...ops] });
  });
  return { calls, off };
}

const ids = (doc: PatchDoc) => [...doc.nodes()].map((n) => n.id);
const rectOf = (doc: PatchDoc, id: string) => doc.node(id)!.rect;
const edgeKeys = (doc: PatchDoc) => [...doc.edges()].map(engineEdgeKey);

/** The cords one op list names under `tag`, as edgeKeys, in the order it names them. */
function edgeOps(ops: readonly Op[], tag: 'add-edge' | 'remove-edge'): string[] {
  return ops.flatMap((op) => (op.t === tag ? [engineEdgeKey(op.edge)] : []));
}

describe('PatchDoc round trips', () => {
  itWithSpecs('undoes and redoes an added box to an identical document', async () => {
    const doc = await PatchDoc.create();
    const before = doc.toIR();

    const box = doc.addBox('cycle~ 440', 30, 40);
    const after = doc.toIR();
    expect(box.numOutlets).toBe(1);
    expect(after.nodes).toHaveLength(1);

    doc.undo();
    expect(doc.toIR()).toEqual(before);
    doc.redo();
    expect(doc.toIR()).toEqual(after);
  });

  itWithSpecs('undoes and redoes a move', async () => {
    const { doc, osc } = await chain();
    const before = doc.toIR();

    doc.moveNodes([osc.id], 40, -15);
    expect(rectOf(doc, osc.id)).toEqual([60, 5, before.nodes[0].rect[2], 22]);
    const after = doc.toIR();

    doc.undo();
    expect(doc.toIR()).toEqual(before);
    doc.redo();
    expect(doc.toIR()).toEqual(after);
  });

  itWithSpecs('undoes and redoes a delete', async () => {
    const { doc, amp } = await chain();
    const before = doc.toIR();

    doc.removeNodes([amp.id]);
    const after = doc.toIR();

    doc.undo();
    // Box order matters: the restored box has to come back in the middle of the array,
    // not at the end, or a saved file would silently reshuffle its boxes.
    expect(doc.toIR()).toEqual(before);
    doc.redo();
    expect(doc.toIR()).toEqual(after);
  });

  itWithSpecs('undoes and redoes a connection', async () => {
    const { doc, osc, dac } = await chain();
    const before = doc.toIR();

    const cord = doc.addEdge({ id: osc.id, outlet: 0 }, { id: dac.id, inlet: 1 });
    expect(cord).not.toBeNull();
    const after = doc.toIR();

    doc.undo();
    expect(doc.toIR()).toEqual(before);
    doc.redo();
    expect(doc.toIR()).toEqual(after);
  });
});

describe('deleting a box', () => {
  itWithSpecs('removes exactly its incident cords, and one undo restores both', async () => {
    const { doc, osc, amp, dac } = await chain();
    // A fourth cord that does NOT touch the box being deleted; it must survive.
    doc.addEdge({ id: osc.id, outlet: 0 }, { id: dac.id, inlet: 1 });
    const before = doc.toIR();
    expect(before.edges).toHaveLength(4);

    const { calls } = record(doc);
    doc.removeNodes([amp.id]);

    expect(doc.nodeCount).toBe(2);
    expect([...doc.edges()]).toEqual([
      { from: { id: osc.id, outlet: 0 }, to: { id: dac.id, inlet: 1 }, domain: 'signal' },
    ]);
    // Cords before the box, so replaying the list in either direction is consistent.
    expect(calls).toHaveLength(1);
    expect(calls[0].tags).toEqual(['remove-edge', 'remove-edge', 'remove-edge', 'remove-node']);

    doc.undo();
    expect(doc.toIR()).toEqual(before);
    expect(doc.canUndo).toBe(true); // the deletion was one entry, not four
  });

  itWithSpecs('deletes several boxes and all their cords as one entry', async () => {
    const { doc, osc, amp } = await chain();
    const before = doc.toIR();

    doc.removeNodes([osc.id, amp.id]);
    expect(doc.nodeCount).toBe(1);
    expect(doc.edgeCount).toBe(0);
    expect(doc.undoLabel).toBe('Delete 2 boxes');

    doc.undo();
    expect(doc.toIR()).toEqual(before);
  });
});

describe('setBoxText', () => {
  itWithSpecs('orphans exactly the cords on ports the new arity removed', async () => {
    const doc = await PatchDoc.create();
    const up = doc.addBox('unpack 1 2 3', 20, 20);
    expect(up.numOutlets).toBe(3);

    const sinks = [0, 1, 2].map((i) => doc.addBox('print', 20 + i * 60, 90));
    sinks.forEach((sink, i) => doc.addEdge({ id: up.id, outlet: i }, { id: sink.id, inlet: 0 }));
    const before = doc.toIR();
    expect(before.edges).toHaveLength(3);

    const { calls } = record(doc);
    doc.setBoxText(up.id, 'unpack 1 2');

    expect(doc.node(up.id)!.numOutlets).toBe(2);
    expect(doc.node(up.id)!.text).toBe('unpack 1 2');
    // Exactly the cord on outlet 2, and it went with the retype in one transaction.
    expect([...doc.edges()].map((e) => e.from.outlet)).toEqual([0, 1]);
    expect(calls).toHaveLength(1);
    // Every cord comes off before the box is replaced and the survivors go back on
    // after — see the next test for why the orphan is not the only one mentioned.
    expect(calls[0].tags).toEqual([
      'remove-edge',
      'remove-edge',
      'remove-edge',
      'set-box',
      'add-edge',
      'add-edge',
    ]);
    // The cord on outlet 2 is the one that is never re-added.
    expect(edgeOps(calls[0].ops, 'add-edge')).toEqual(
      [0, 1].map((i) => `${up.id}:${i}>${sinks[i].id}:0`),
    );

    // One Cmd-Z brings back the text AND the cord.
    doc.undo();
    expect(doc.node(up.id)!.text).toBe('unpack 1 2 3');
    expect(doc.toIR()).toEqual(before);
  });

  itWithSpecs('re-makes a surviving cord whose transport changed', async () => {
    const { doc, osc, amp } = await chain();
    const before = doc.toIR();
    const cordKey = engineEdgeKey({
      from: { id: osc.id, outlet: 0 },
      to: { id: amp.id, inlet: 0 },
      domain: 'signal',
    });
    expect(doc.edge(cordKey)!.domain).toBe('signal');

    const { calls } = record(doc);
    doc.setBoxText(osc.id, '+ 1'); // signal outlet becomes a control outlet

    expect(calls[0].tags).toEqual(['remove-edge', 'set-box', 'add-edge']);
    // Same cord, same key, different wire — the engine has to re-connect it, and there
    // is no op that means "same cord, other transport". The add lands AFTER the set-box
    // so that it is made against the new object, not the one about to be thrown away.
    expect(calls[0].ops[2]).toMatchObject({ t: 'add-edge', edge: { domain: 'control' } });
    expect(doc.edge(cordKey)!.domain).toBe('control');
    expect(doc.edgeCount).toBe(3);

    doc.undo();
    expect(doc.toIR()).toEqual(before);
  });

  itWithSpecs('re-makes every surviving cord, not just the ones it invalidated', async () => {
    // set-box is the one op that re-instantiates an object, so every cord on the box is
    // gone from the engine's point of view whether or not the document still lists it.
    // An op list that named only the orphans would leave a listener that replays the
    // feed — which is exactly what Phase 5's Engine.applyOps is — holding connections
    // into a disposed node, silently, until the next full build().
    const { doc, amp } = await chain();
    const before = doc.toIR();
    const incident = doc.edgesOf(amp.id).map(engineEdgeKey);
    expect(incident).toHaveLength(3); // one in, two out — none of them orphaned below

    const { calls } = record(doc);
    doc.setBoxText(amp.id, '*~ 0.5'); // same class, same arity, same domains

    expect(calls).toHaveLength(1);
    expect(calls[0].tags).toEqual([
      'remove-edge',
      'remove-edge',
      'remove-edge',
      'set-box',
      'add-edge',
      'add-edge',
      'add-edge',
    ]);
    expect(edgeOps(calls[0].ops, 'remove-edge').sort()).toEqual([...incident].sort());
    expect(edgeOps(calls[0].ops, 'add-edge').sort()).toEqual([...incident].sort());
    // …and the document is where it was: the churn is for the engine, not a real change.
    expect(doc.edgeCount).toBe(3);
    expect(doc.node(amp.id)!.text).toBe('*~ 0.5');

    doc.undo();
    expect(doc.toIR()).toEqual(before);
  });

  itWithSpecs('keeps a box’s ports and cords when the name stops being recognized', async () => {
    // resolveBox reports 0 in / 0 out for a name no object has, which is a statement
    // about this app's catalog rather than about the box. Adopting it would amputate
    // every cord the instant a keystroke made the name unrecognizable — and correcting
    // the typo would NOT bring them back, because the document no longer has them.
    const { doc, osc, amp, dac } = await chain();
    const before = doc.toIR();

    doc.setBoxText(amp.id, '*z~ 0.2'); // a typo, mid-edit
    const broken = doc.node(amp.id)!;
    expect(broken.known).toBe(false); // drawn as unresolved…
    expect([broken.numInlets, broken.numOutlets]).toEqual([2, 1]); // …but still a box
    expect(broken.outletDomains).toEqual(['signal']);
    expect(doc.edgeCount).toBe(3);
    expect(doc.edgesOf(amp.id)).toHaveLength(3);

    doc.setBoxText(amp.id, '*~ 0.2'); // corrected
    expect(doc.node(amp.id)!.known).toBe(true);
    expect(doc.toIR()).toEqual(before);
    expect(edgeKeys(doc)).toEqual([
      `${osc.id}:0>${amp.id}:0`,
      `${amp.id}:0>${dac.id}:0`,
      `${amp.id}:0>${dac.id}:1`,
    ]);
  });

  itWithSpecs('renames a subpatcher without severing it from the patch', async () => {
    // `p` is Max's own abbreviation for `patcher`; its real arity comes from the nested
    // patcher's inlet/outlet objects, which this IR does not model, so it is permanently
    // an unrecognized name here. Renaming a subpatch is about the most ordinary edit
    // there is, and it must not silently break the audio path.
    //
    // Note for whoever closes the catalog gap: adding `p` -> `patcher` to
    // maxpylang/data/OBJ_INFO/obj_aliases.json alone will fail this test rather than fix
    // it. The manifest gives `patcher` 0 inlets and 0 outlets (as it does `send` and
    // `value`), so the box would become KNOWN-but-portless, walk straight past the
    // unresolved-name guard in setBoxText, and lose its cords exactly as before. A
    // subpatcher's arity has to come from recursing into the nested patcher.
    const raw = load('examples/variable-osc-synth/additive-bottom.maxpat');
    const doc = await PatchDoc.open(parseMaxPat(raw));
    const sub = [...doc.nodes()].find((n) => n.text === 'p delay')!;
    const cords = doc.edgesOf(sub.id).map(engineEdgeKey);
    expect(cords).toHaveLength(3);
    const total = doc.edgeCount;

    doc.setBoxText(sub.id, 'p delay2');

    expect(doc.node(sub.id)!.text).toBe('p delay2');
    expect(doc.edgeCount).toBe(total);
    expect(doc.edgesOf(sub.id).map(engineEdgeKey)).toEqual(cords);
    // The saved box still declares the ports Max will re-derive, and still carries the
    // whole nested patcher.
    const box = nodeToBox(doc.node(sub.id)!);
    expect([box.numinlets, box.numoutlets]).toEqual([1, 2]);
    expect(box.outlettype).toEqual(['signal', 'signal']);
    expect((box.patcher as { boxes: unknown[] }).boxes.length).toBeGreaterThan(0);
  });

  itWithSpecs('keeps the box where it is and re-fits it to the new text', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 55, 70);
    const width = box.rect[2];

    doc.setBoxText(box.id, 'cycle~ 440 mybuffer extra');
    const moved = doc.node(box.id)!;
    expect(moved.rect[0]).toBe(55);
    expect(moved.rect[1]).toBe(70);
    expect(moved.rect[2]).toBeGreaterThan(width);
  });

  itWithSpecs('is not an edit when the text is unchanged', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 0, 0);
    const rev = doc.revision;
    doc.setBoxText(box.id, 'cycle~ 440');
    expect(doc.revision).toBe(rev);
    expect(doc.undoLabel).toBe('Add cycle~');
  });
});

describe('moving', () => {
  itWithSpecs('collapses a 20-step coalesced drag into one undo entry', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 0, 0);
    const { calls } = record(doc);

    for (let i = 0; i < 20; i++) doc.moveNodes([box.id], 5, 2, true);

    expect(rectOf(doc, box.id).slice(0, 2)).toEqual([100, 40]);
    // Every step still reaches the change feed — the canvas has to follow the pointer —
    // but they share a single undo entry.
    expect(calls).toHaveLength(20);
    expect(doc.revision).toBeGreaterThan(20);

    doc.undo();
    expect(rectOf(doc, box.id).slice(0, 2)).toEqual([0, 0]);
    expect(doc.undoLabel).toBe('Add cycle~'); // the whole drag was ONE entry
  });

  itWithSpecs('keeps every step when the caller does not ask to coalesce', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 0, 0);
    for (let i = 0; i < 5; i++) doc.moveNodes([box.id], 5, 0);

    for (let i = 0; i < 5; i++) doc.undo();
    expect(rectOf(doc, box.id)[0]).toBe(0);
    expect(doc.undoLabel).toBe('Add cycle~');
  });

  itWithSpecs('does not coalesce across a different set of boxes', async () => {
    const { doc, osc, amp } = await chain();
    doc.moveNodes([osc.id], 10, 0, true);
    doc.moveNodes([osc.id, amp.id], 10, 0, true);
    doc.moveNodes([osc.id], 10, 0, true);

    doc.undo(); // only the third gesture
    expect(rectOf(doc, osc.id)[0]).toBe(40);
    expect(rectOf(doc, amp.id)[0]).toBe(30);
  });

  itWithSpecs('is not an edit when the delta is zero, and does not end the drag', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 0, 0);
    const { calls } = record(doc);
    const rev = doc.revision;

    doc.moveNodes([box.id], 0, 0, true);
    expect(calls).toHaveLength(0);
    expect(doc.revision).toBe(rev);

    // The canvas snaps to an 8px grid, so a slow drag emits a zero-delta step on every
    // frame that lands in the cell it is already in. If that broke the coalesce chain,
    // one gesture would become a dozen undo entries and the user would have to press
    // Cmd-Z a dozen times to put the box back.
    doc.moveNodes([box.id], 10, 0, true);
    doc.moveNodes([box.id], 0, 0, true);
    doc.moveNodes([box.id], 10, 0, true);
    expect(rectOf(doc, box.id)[0]).toBe(20);

    doc.undo();
    expect(rectOf(doc, box.id)[0]).toBe(0);
    expect(doc.undoLabel).toBe('Add cycle~'); // the whole drag was still ONE entry
  });

  itWithSpecs('starts a fresh entry for a drag that follows an undo or a redo', async () => {
    const doc = await PatchDoc.create();
    const box = doc.addBox('cycle~ 440', 0, 0);
    doc.moveNodes([box.id], 4, 0, true);
    doc.moveNodes([box.id], 3, 0, true);
    expect(doc.undoLabel).toBe('Move');

    doc.undo(); // takes the whole drag back — and ends it
    expect(rectOf(doc, box.id)[0]).toBe(0);
    expect(doc.undoLabel).toBe('Add cycle~');

    // Same box, same coalesce key, but a different gesture: merging it into the entry
    // now on top (Add cycle~) would make the next Cmd-Z delete the box instead of
    // undoing the move, and leave nothing to undo after that.
    doc.moveNodes([box.id], 7, 0, true);
    expect(doc.undoLabel).toBe('Move');
    doc.undo();
    expect(doc.nodeCount).toBe(1);
    expect(doc.node(box.id)).toBeDefined();
    expect(rectOf(doc, box.id)[0]).toBe(0);
    expect(doc.canUndo).toBe(true);

    // The symmetric guard on redo(). Reachable only if undo's ever stops clearing the
    // key first, which is precisely when it would matter.
    doc.redo();
    expect(rectOf(doc, box.id)[0]).toBe(7);
    doc.moveNodes([box.id], 5, 0, true);
    expect(doc.undoLabel).toBe('Move');
    doc.undo();
    expect(rectOf(doc, box.id)[0]).toBe(7);
  });

  itWithSpecs('does not let a coalesced move hijack a compound gesture’s entry', async () => {
    // Coalescing is a claim about who owns the undo entry, so it only applies when
    // moveNodes opens the transaction itself. Inside a caller's transaction the entry
    // belongs to the caller and already covers the whole gesture — an align, a
    // paste-then-nudge — and folding that into the preceding drag would put the
    // compound edit's add-node and remove-edge ops under the label "Move".
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    doc.moveNodes([a.id], 10, 0, true);
    expect(doc.undoLabel).toBe('Move');

    doc.transact('Align', () => {
      doc.moveNodes([a.id], 5, 0, true);
      doc.addBox('print', 0, 200);
    });

    expect(doc.undoLabel).toBe('Align');
    expect(doc.nodeCount).toBe(2);

    doc.undo();
    expect(doc.nodeCount).toBe(1);
    expect(rectOf(doc, a.id)[0]).toBe(10); // the earlier drag is still there
  });
});

describe('connecting', () => {
  itWithSpecs('refuses a duplicate cord and an out-of-range port, without throwing', async () => {
    const { doc, osc, amp } = await chain();
    const rev = doc.revision;

    expect(doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: 7 }, { id: amp.id, inlet: 0 })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 9 })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: -1 }, { id: amp.id, inlet: 0 })).toBeNull();
    expect(doc.addEdge({ id: 'obj-404', outlet: 0 }, { id: amp.id, inlet: 0 })).toBeNull();

    // A port index is a port index. NaN passes every comparison (`NaN < 0` and
    // `NaN >= numOutlets` are both false) and a fraction passes the range check too, so
    // a patcher deriving one from `Number(el.dataset.port)` on a missing or malformed
    // attribute would otherwise mint a cord the engine can never look up.
    expect(doc.addEdge({ id: osc.id, outlet: Number.NaN }, { id: amp.id, inlet: 0 })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: Number.NaN })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: 0.5 }, { id: amp.id, inlet: 0 })).toBeNull();
    expect(doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 1.5 })).toBeNull();

    // A refused gesture is not an edit at all.
    expect(doc.revision).toBe(rev);
    expect(doc.edgeCount).toBe(3);
  });

  itWithSpecs('reads the cord domain off the source outlet', async () => {
    const { doc, osc, amp, dac } = await chain();
    expect(doc.edgesOf(amp.id).map((e) => e.domain)).toEqual(['signal', 'signal', 'signal']);

    const num = doc.addBox('metro 500', 200, 20);
    const cord = doc.addEdge({ id: num.id, outlet: 0 }, { id: amp.id, inlet: 1 })!;
    expect(cord.domain).toBe('control');
    expect(doc.edgesOf(osc.id)).toHaveLength(1);
    expect(doc.edgesOf(dac.id)).toHaveLength(2);
  });

  itWithSpecs('cuts a cord by the key the engine stores it under', async () => {
    const { doc, amp, dac } = await chain();
    const cord = [...doc.edges()].find((e) => e.to.id === dac.id && e.to.inlet === 1)!;
    const key = engineEdgeKey(cord);
    expect(doc.edge(key)).toBe(cord);

    doc.removeEdge(key);
    expect(doc.edge(key)).toBeUndefined();
    expect(doc.edgesOf(amp.id)).toHaveLength(2);

    doc.removeEdge(key); // already gone: a no-op, not a throw
    expect(doc.undoLabel).toBe('Disconnect');
    doc.undo();
    expect(doc.edge(key)).toEqual(cord);
  });
});

describe('ids', () => {
  itWithSpecs('never reuses a freed id, and reorder() densifies undoably', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    const b = doc.addBox('*~ 0.2', 0, 50);
    const c = doc.addBox('ezdac~', 0, 100);
    expect([a.id, b.id, c.id]).toEqual(['obj-1', 'obj-2', 'obj-3']);
    doc.addEdge({ id: a.id, outlet: 0 }, { id: c.id, inlet: 0 });

    doc.removeNodes([b.id]);
    const d = doc.addBox('metro 500', 0, 150);
    // obj-2 is free, and taking it would re-point the undo record that still names it.
    expect(d.id).toBe('obj-4');
    expect(ids(doc)).toEqual(['obj-1', 'obj-3', 'obj-4']);

    const map = doc.reorder();
    expect(map).toEqual({ 'obj-1': 'obj-1', 'obj-3': 'obj-2', 'obj-4': 'obj-3' });
    expect(ids(doc)).toEqual(['obj-1', 'obj-2', 'obj-3']);
    // Cords follow their boxes, under the new key.
    expect([...doc.edges()]).toEqual([
      { from: { id: 'obj-1', outlet: 0 }, to: { id: 'obj-2', inlet: 0 }, domain: 'signal' },
    ]);
    expect(doc.edge(engineEdgeKey([...doc.edges()][0]))).toBeDefined();

    doc.undo();
    expect(ids(doc)).toEqual(['obj-1', 'obj-3', 'obj-4']);
    expect([...doc.edges()][0].to.id).toBe('obj-3');
  });

  itWithSpecs('reorder() on an already-dense patch is not an edit', async () => {
    const doc = await PatchDoc.create();
    doc.addBox('cycle~ 440', 0, 0);
    doc.addBox('ezdac~', 0, 50);
    const rev = doc.revision;

    expect(doc.reorder()).toEqual({ 'obj-1': 'obj-1', 'obj-2': 'obj-2' });
    expect(doc.revision).toBe(rev);
  });

  itWithSpecs('tells listeners how the cord KEYS moved, not just the box ids', async () => {
    // Every consumer stores a cord under its edgeKey — Engine.videoEdges today, Phase
    // 5's Map<edgeKey, teardown>, Phase 4's Map<edgeKey, path>, the patcher's selected
    // cord. Renaming a box rewrites those keys, and reconstructing the new one from the
    // node map alone means taking the key format apart somewhere else, which is the
    // second definition of cord identity doc/ops exists to prevent.
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    const b = doc.addBox('*~ 0.2', 0, 50);
    const c = doc.addBox('ezdac~', 0, 100);
    doc.addEdge({ id: a.id, outlet: 0 }, { id: c.id, inlet: 0 });
    doc.removeNodes([b.id]);
    const wasKey = edgeKeys(doc)[0];
    expect(wasKey).toBe('obj-1:0>obj-3:0');

    const { calls } = record(doc);
    doc.reorder();

    const op = calls[0].ops[0];
    expect(op.t).toBe('renumber');
    if (op.t !== 'renumber') return;
    expect(op.edgeMap).toEqual({ 'obj-1:0>obj-3:0': 'obj-1:0>obj-2:0' });
    // Not a guess: that really is where the cord is now.
    expect(doc.edge(op.edgeMap[wasKey])).toBeDefined();
    expect(edgeKeys(doc)).toEqual([op.edgeMap[wasKey]]);

    doc.undo();
    const back = calls[1].ops[0];
    expect(back.t).toBe('renumber');
    if (back.t !== 'renumber') return;
    expect(back.edgeMap).toEqual({ 'obj-1:0>obj-2:0': 'obj-1:0>obj-3:0' });
    expect(doc.edge(back.edgeMap['obj-1:0>obj-2:0'])).toBeDefined();
  });

  itWithSpecs('denseIdMap() is what a save asks for: the map, and no edit', async () => {
    // Densifying ids is a serialization concern. reorder() is an edit — it costs a Cmd-Z
    // and clears the redo stack — so a save or a debounced codegen regeneration must use
    // this instead, and patchToMaxPat's `renumber` option applies the same map to its own
    // output without touching the document.
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    const b = doc.addBox('*~ 0.2', 0, 50);
    doc.addBox('ezdac~', 0, 100);
    doc.removeNodes([b.id]);
    doc.moveNodes([a.id], 10, 0);
    doc.undo(); // leaves a pending redo, which a save must not throw away
    const rev = doc.revision;
    const { calls } = record(doc);

    const map = doc.denseIdMap();

    expect(map).toEqual({ 'obj-1': 'obj-1', 'obj-3': 'obj-2' });
    expect(ids(doc)).toEqual(['obj-1', 'obj-3']); // the document is untouched
    expect(doc.revision).toBe(rev);
    expect(calls).toHaveLength(0);
    expect(doc.undoLabel).toBe('Delete box');
    expect(doc.canRedo).toBe(true);
    // Same answer reorder() would give, so the two cannot drift apart.
    expect(doc.reorder()).toEqual(map);
  });

  itWithSpecs('a renumber keeps a deleted box’s place in the box order', async () => {
    // applyRenumber rebuilds both stores, and a rebuild that kept only the live entries
    // would throw away where the deleted boxes used to sit. That is invisible at the
    // time and shows up later: rollback() replays the inverse renumber and reports the
    // transaction fully undone, but a subsequent Cmd-Z brings the box back at the END of
    // the box order, and the writer serializes boxes in that order.
    const build = async () => {
      const d = await PatchDoc.create();
      d.addBox('cycle~ 440', 0, 0);
      const mid = d.addBox('*~ 0.2', 0, 50);
      d.addBox('ezdac~', 0, 100);
      d.removeNodes([mid.id]);
      return d;
    };
    const control = await build();
    const victim = await build();

    expect(() =>
      victim.transact('Save', () => {
        victim.reorder();
        throw new Error('write failed');
      }),
    ).toThrow('write failed');
    expect(victim.toIR()).toEqual(control.toIR()); // the rollback looks complete…

    control.undo();
    victim.undo();
    // …and it has to still be complete one step later.
    expect(ids(victim)).toEqual(['obj-1', 'obj-2', 'obj-3']);
    expect(ids(victim)).toEqual(ids(control));
    expect(victim.toIR()).toEqual(control.toIR());
  });

  itWithSpecs('undoing a committed renumber restores the deleted box’s slot too', async () => {
    const doc = await PatchDoc.create();
    doc.addBox('cycle~ 440', 0, 0);
    const mid = doc.addBox('*~ 0.2', 0, 50);
    doc.addBox('ezdac~', 0, 100);
    doc.removeNodes([mid.id]);
    doc.reorder();
    expect(ids(doc)).toEqual(['obj-1', 'obj-2']);

    doc.undo(); // the renumber
    doc.undo(); // the delete
    expect(ids(doc)).toEqual(['obj-1', 'obj-2', 'obj-3']);
    expect(doc.node('obj-2')!.text).toBe('*~ 0.2'); // back in the middle, not at the end
  });

  itWithSpecs('drops a cord whose endpoint box is not in the file', async () => {
    // parseMaxPat tolerates a patchline naming a box that isn't there (hand-edited file,
    // a box another tool deleted, a box whose id wasn't a string). A phantom id is the
    // one id a renumber cannot rename — reorder's map only covers live boxes — so the
    // cord would keep `obj-1` while a real box was renamed ONTO obj-1, either evicting a
    // real cord that collided with it or wiring up a connection the file never had.
    const ir = parseMaxPat({
      patcher: {
        rect: [0, 0, 800, 600],
        boxes: [
          {
            box: {
              id: 'obj-2',
              maxclass: 'newobj',
              text: 'cycle~ 440',
              numinlets: 2,
              numoutlets: 1,
              outlettype: ['signal'],
              patching_rect: [10, 10, 70, 22],
            },
          },
          {
            box: {
              id: 'obj-3',
              maxclass: 'newobj',
              text: 'ezdac~',
              numinlets: 2,
              numoutlets: 0,
              patching_rect: [10, 80, 50, 22],
            },
          },
        ],
        lines: [
          { patchline: { source: ['obj-2', 0], destination: ['obj-3', 0], order: 1 } },
          { patchline: { source: ['obj-1', 0], destination: ['obj-3', 0] } },
        ],
      },
    });
    expect(ir.edges.map(engineEdgeKey)).toEqual(['obj-2:0>obj-3:0', 'obj-1:0>obj-3:0']);

    const doc = await PatchDoc.open(ir);
    expect(doc.edgeCount).toBe(1);
    expect(edgeKeys(doc)).toEqual(['obj-2:0>obj-3:0']);
    // The one that survived is the REAL cord, with its `order` — not the phantom that
    // would have inherited its key.
    expect([...doc.edges()][0].raw).toMatchObject({ order: 1 });

    doc.reorder();
    expect(edgeKeys(doc)).toEqual(['obj-1:0>obj-2:0']);
    expect([...doc.edges()][0].raw).toMatchObject({ order: 1 });
  });

  itWithSpecs('continues a parsed patch’s numbering', async () => {
    const doc = await PatchDoc.create();
    const seed = doc.addBox('cycle~ 440', 0, 0);
    const reopened = PatchDoc.fromIR(doc.toIR());
    expect(reopened.node(seed.id)).toBeDefined();
    expect(reopened.addBox('print', 0, 60).id).toBe('obj-2');
  });
});

describe('transactions and the change feed', () => {
  itWithSpecs('flattens nested transacts into one entry, one call, one revision', async () => {
    const doc = await PatchDoc.create();
    const { calls } = record(doc);
    const rev = doc.revision;

    const made = doc.transact('Paste', () => {
      const osc = doc.addBox('cycle~ 440', 0, 0);
      const dac = doc.transact('inner', () => doc.addBox('ezdac~', 0, 60));
      doc.addEdge({ id: osc.id, outlet: 0 }, { id: dac.id, inlet: 0 });
      return [osc, dac] as IRNode[];
    });

    expect(made).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].tags).toEqual(['add-node', 'add-node', 'add-edge']);
    expect(doc.revision).toBe(rev + 1);
    expect(doc.undoLabel).toBe('Paste'); // the outer label wins

    doc.undo();
    expect(doc.nodeCount).toBe(0);
    expect(doc.edgeCount).toBe(0);
  });

  itWithSpecs('tags the source of every notification', async () => {
    const { doc, amp } = await chain();
    const { calls, off } = record(doc);

    doc.removeNodes([amp.id]);
    doc.undo();
    doc.redo();

    expect(calls.map((c) => c.source)).toEqual(['apply', 'undo', 'redo']);
    // Undo reports the INVERSES, in the order they were applied, so a listener can
    // replay them without knowing anything about undo.
    expect(calls[1].tags).toEqual(['add-node', 'add-edge', 'add-edge', 'add-edge']);
    expect(calls[2].tags).toEqual(calls[0].tags);

    off();
    doc.undo();
    expect(calls).toHaveLength(3);
  });

  itWithSpecs('bumps the revision once per transaction, not once per op', async () => {
    const { doc, osc, amp, dac } = await chain();
    const rev = doc.revision;

    doc.removeNodes([osc.id, amp.id, dac.id]); // 3 cords + 3 boxes = 6 ops
    expect(doc.revision).toBe(rev + 1);

    doc.undo();
    expect(doc.revision).toBe(rev + 2);
    doc.redo();
    expect(doc.revision).toBe(rev + 3);
  });

  itWithSpecs('an empty transaction is not an edit', async () => {
    const { doc } = await chain();
    const { calls } = record(doc);
    const rev = doc.revision;
    const label = doc.undoLabel;

    doc.transact('nothing', () => undefined);
    expect(calls).toHaveLength(0);
    expect(doc.revision).toBe(rev);
    expect(doc.undoLabel).toBe(label);
  });

  itWithSpecs('rolls a throwing transaction all the way back', async () => {
    const { doc } = await chain();
    const before = doc.toIR();
    const { calls } = record(doc);

    expect(() =>
      doc.transact('Paste', () => {
        doc.addBox('cycle~ 220', 200, 200);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    // A half-applied edit must never reach the engine, so nothing is applied and nothing
    // is announced. The burnt id is not recycled, by design.
    expect(doc.toIR()).toEqual(before);
    expect(calls).toHaveLength(0);
    expect(doc.addBox('print', 0, 0).id).toBe('obj-5');
  });

  itWithSpecs('survives a listener that throws', async () => {
    const doc = await PatchDoc.create();
    const seen: DocSource[] = [];
    doc.on(() => {
      throw new Error('listener is broken');
    });
    doc.on((_ops, source) => seen.push(source));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    doc.addBox('cycle~ 440', 0, 0);
    expect(seen).toEqual(['apply']);
    expect(doc.nodeCount).toBe(1);
    spy.mockRestore();
  });

  itWithSpecs('delivers every op list to every listener in commit order', async () => {
    // transact() closes the transaction before notifying precisely so a listener may
    // open one of its own — an auto-connect rule, a validator. That nested edit commits
    // while the notification loop is still part-way down the listener list, so without a
    // queue every listener registered AFTER the mutating one sees the nested ops FIRST.
    // A consumer that replays the feed verbatim (Phase 5's Engine.applyOps) would then
    // be told to wire a cord whose source it has not instantiated, drop it, and never be
    // told again: the document has the cord, the audio graph silently does not.
    const doc = await PatchDoc.create();
    let armed = true;
    doc.on((ops) => {
      if (!armed) return;
      const added = ops.find((o) => o.t === 'add-node');
      if (!added || added.t !== 'add-node' || added.node.text !== 'cycle~ 440') return;
      armed = false;
      const dac = doc.addBox('ezdac~', 0, 100);
      doc.addEdge({ id: added.node.id, outlet: 0 }, { id: dac.id, inlet: 0 });
    });

    // A minimal Engine.applyOps: one handler per op, applied in stream order, with no
    // access to the document. It can only wire a cord between objects it already has.
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const dropped: string[] = [];
    const seen: string[] = [];
    doc.on((ops) => {
      seen.push(ops.map((o) => o.t).join('+'));
      for (const op of ops) {
        if (op.t === 'add-node') nodes.add(op.node.id);
        else if (op.t === 'remove-node') nodes.delete(op.node.id);
        else if (op.t === 'add-edge') {
          if (nodes.has(op.edge.from.id) && nodes.has(op.edge.to.id)) {
            edges.add(engineEdgeKey(op.edge));
          } else dropped.push(engineEdgeKey(op.edge));
        } else if (op.t === 'remove-edge') edges.delete(engineEdgeKey(op.edge));
      }
    });

    doc.addBox('cycle~ 440', 0, 0);

    expect(seen).toEqual(['add-node', 'add-node', 'add-edge']);
    expect(dropped).toEqual([]);
    expect([...edges]).toEqual(edgeKeys(doc));
    expect([...nodes].sort()).toEqual(ids(doc).sort());
  });

  itWithSpecs('keeps the feed in order when a listener undoes the edit it just saw', async () => {
    const doc = await PatchDoc.create();
    let armed = true;
    doc.on(() => {
      if (!armed) return;
      armed = false;
      doc.undo();
    });
    const nodes = new Set<string>();
    doc.on((ops) => {
      for (const op of ops) {
        if (op.t === 'add-node') nodes.add(op.node.id);
        else if (op.t === 'remove-node') nodes.delete(op.node.id);
      }
    });

    doc.addBox('cycle~ 440', 0, 0);

    // The replay must not be left holding a box the document has already deleted.
    expect(doc.nodeCount).toBe(0);
    expect([...nodes]).toEqual([]);
  });

  itWithSpecs('a new edit invalidates a pending redo', async () => {
    // Without this, redo() would replay ops against a document that has since diverged.
    // applyOp skips what it cannot find rather than throwing, so the result would be a
    // half-applied delete with no error anywhere.
    const { doc, amp } = await chain();
    doc.removeNodes([amp.id]);
    doc.undo();
    expect(doc.canRedo).toBe(true);

    doc.addBox('print', 200, 200);
    expect(doc.canRedo).toBe(false);

    const before = doc.toIR();
    doc.redo();
    expect(doc.toIR()).toEqual(before);
  });

  itWithSpecs('refuses to undo from inside a transaction', async () => {
    const doc = await PatchDoc.create();
    doc.addBox('cycle~ 440', 0, 0);
    expect(() => doc.transact('bad', () => doc.undo())).toThrow(/inside a transaction/);
    expect(doc.nodeCount).toBe(1);
  });
});

describe('document contents', () => {
  itWithSpecs('carries the header and the default box dict through toIR()', async () => {
    const doc = await PatchDoc.create({ rect: [0, 0, 640, 480], appversion: { major: 8 } });
    const box = doc.addBox('cycle~ 440', 12, 34);
    const ir = doc.toIR();

    expect(ir.header).toEqual({ rect: [0, 0, 640, 480], appversion: { major: 8 } });
    expect(ir.byId.get(box.id)).toBe(box);
    // The stampable default box dict rides along, so saving a box built here writes the
    // same Max keys a box created in Max would have.
    expect(box.raw).toMatchObject({ maxclass: 'newobj' });
    expect(box.outletTypes).toEqual(['signal']);
    expect(box.outletDomains).toEqual(['signal']);
  });

  itWithSpecs('copies the header in rather than aliasing the caller’s', async () => {
    // toIR() hands back the LIVE header, so PatchDoc.fromIR(other.toIR()) would put two
    // documents behind one object and resizing one patch's window would resize the
    // other's. And EMPTY_PATCHER_HEADER — the base for every new patch — is deep-frozen,
    // so an aliasing constructor makes the first `doc.header.x = …` throw.
    const ir: IRPatch = {
      nodes: [],
      edges: [],
      byId: new Map(),
      header: { rect: [0, 0, 100, 100] },
    };
    const doc = PatchDoc.fromIR(ir);
    doc.header.rect = [1, 2, 3, 4];
    expect(ir.header!.rect).toEqual([0, 0, 100, 100]);

    const fresh = PatchDoc.empty(EMPTY_PATCHER_HEADER);
    expect(fresh.header).not.toBe(EMPTY_PATCHER_HEADER);
    expect(() => {
      fresh.header.openinpresentation = 1;
    }).not.toThrow();
    expect(EMPTY_PATCHER_HEADER.openinpresentation).toBe(0);
  });

  itWithSpecs('adopts a parsed patch without rewriting it', async () => {
    const { doc } = await chain();
    const ir = doc.toIR();
    const reopened = await PatchDoc.open(ir);
    expect(reopened.toIR()).toEqual(ir);
    expect([...reopened.nodes()][0]).toBe(ir.nodes[0]);
  });

  it('refuses to resolve box text before the box specs are loaded', async () => {
    // A doc built without awaiting the specs would give unpack/trigger/route/pack the
    // wrong number of ports and silently refuse the cords the user then drew, so the
    // deficiency is raised at the call rather than baked into the patch. Fresh module
    // registry, because loadBoxSpecs() caches process-wide once anything has awaited it.
    vi.resetModules();
    const { PatchDoc: Fresh } = await import('../src/doc/patch-doc');
    const doc = Fresh.empty();
    expect(() => doc.addBox('unpack 1 2 3', 0, 0)).toThrow(/boxspecs\.json is not loaded/);
    expect(doc.nodeCount).toBe(0);

    const ready = await Fresh.create();
    expect(ready.addBox('unpack 1 2 3', 0, 0).numOutlets).toBe(3);
  });
});
