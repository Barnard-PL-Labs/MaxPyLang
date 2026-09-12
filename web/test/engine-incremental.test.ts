// The incremental engine — the half of engine.ts that makes a live canvas possible.
//
// Everything below build() exists for one promise: an edit costs the audio graph only
// what that edit actually changed, and the most frequent edit of all — dragging a box —
// costs it nothing. Until this file existed that promise was enforced by nothing. Two
// mutations proved it: making `applyOps` return immediately (the engine stops following
// the document at all) and routing `set-rect` through `replaceNode` (the exact
// catastrophe the ops design was written to prevent — every box rebuilt ~60 times a
// second while you drag it) both left the whole suite green.
//
// So the assertions here are deliberately about IDENTITY and about CORD BOOKKEEPING,
// not about behaviour that a rebuild would also satisfy:
//
//   • `expect(engine.getNode(id)).toBe(before)` — Object.is, so a rebuilt-but-equivalent
//     object fails. This is what says an oscillator does not restart from phase 0, a
//     metro does not lose its schedule, and a mounted widget's DOM survives a drag.
//   • `engine.liveCords` versus the document's edgeKeys — the engine and the document
//     must name the same cords after ANY op list, because a cord the engine still
//     carries and the canvas no longer draws is a sound with no visible source.
//   • a cut cord really stops carrying messages/signal, which is what `disconnect()`'s
//     teardown thunk is for and what deleting the `teardown();` call silently broke.
//
// Headless (Node) against test/setup/webaudio-mock.ts. Nothing here is acoustic: the
// audible consequence of a cleared patch is asserted for real, in a real
// OfflineAudioContext, in test/browser/engine-clear.test.ts.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects'; // bootstrap: registers real objects + Tier-A stubs
import { Engine, edgeKey } from '../src/engine/engine';
import { PatchDoc } from '../src/doc/patch-doc';
import { loadBoxSpecs } from '../src/ir/objectspec';
import { buses } from '../src/runtime/buses';
import { scheduler } from '../src/runtime/scheduler';
import type { Msg } from '../src/runtime/atoms';
import type { IREdge, IRNode, IRPatch } from '../src/ir/types';
import type { MaxNode } from '../src/engine/registry';

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;
const newCtx = () => new OfflineCtx(2, 128, 44100);

// Same guard as doc.test.ts: PatchDoc needs the generated box specs for real arity, and
// a checkout that has not run `npm run gen:manifest` should skip rather than fail.
const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

afterEach(() => {
  scheduler.clear();
  buses.clear();
  vi.restoreAllMocks();
});

/** A minimal IRNode: the engine builds from className and args, never from geometry. */
function node(
  id: string,
  className: string,
  outletDomains: IRNode['outletDomains'],
  args: IRNode['args'] = [],
): IRNode {
  return {
    id, className, args, maxclass: 'newobj',
    numInlets: 2, numOutlets: outletDomains.length, outletDomains,
    rect: [0, 0, 40, 20], text: [className, ...args].join(' '),
  };
}

function patchOf(nodes: IRNode[], edges: IREdge[] = []): IRPatch {
  return { nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])) };
}

const cord = (from: string, outlet: number, to: string, inlet: number, domain: IREdge['domain']): IREdge =>
  ({ from: { id: from, outlet }, to: { id: to, inlet }, domain });

/** A document wired to an engine exactly as src/patcher/main.ts wires them. */
async function live() {
  const doc = await PatchDoc.create();
  const engine = new Engine(newCtx());
  const off = doc.on((ops) => engine.applyOps(ops, doc));
  return { doc, engine, off };
}

const docCords = (doc: PatchDoc) => [...doc.edges()].map(edgeKey).sort();

/**
 * Did this disconnect() spy get called with exactly that node?
 *
 * By IDENTITY rather than through toHaveBeenCalledWith: the headless Web Audio mock is
 * a Proxy whose `has` trap answers true for every key, which sends a structural
 * comparison off looking for an iterator. Identity is also the stricter question — the
 * point is that the cord's own destination was named, not that something equal to it was.
 */
function calledWith(spy: { mock: { calls: unknown[][] } }, target: unknown): boolean {
  return spy.mock.calls.some((args) => args[0] === target);
}

describe('set-rect costs the engine nothing', () => {
  it('moving a box keeps the very same live object, and builds none', () => {
    const engine = new Engine(newCtx());
    const patch = patchOf([
      node('obj-1', 'cycle~', ['signal'], [440]),
      node('obj-2', 'ezdac~', []),
    ], [cord('obj-1', 0, 'obj-2', 0, 'signal')]);
    const report = engine.build(patch);
    const before = report.built.get('obj-1')!;
    const sizeBefore = report.built.size;
    // Spied AFTER the build, so a re-instantiation would have to dispose this one.
    const disposed = vi.fn();
    (before as { dispose?: () => void }).dispose = disposed;

    // The op every pointermove of a drag emits, and there are ~60 of them a second.
    // The document is handed over in full, so a `set-rect` branch that reached for
    // doc.node() and rebuilt from it would have everything it needed to succeed.
    const moved: IRNode = { ...patch.nodes[0], rect: [80, 0, 40, 20] };
    engine.applyOps(
      [{ t: 'set-rect', id: 'obj-1', from: [0, 0, 40, 20], to: [80, 0, 40, 20] }],
      { node: (id: string) => (id === 'obj-1' ? moved : undefined) } as unknown as PatchDoc,
    );

    expect(engine.getNode('obj-1'), 'the same live object survives a move').toBe(before);
    expect(disposed).not.toHaveBeenCalled();
    expect(report.built.size).toBe(sizeBefore);
    // …and the cord it hangs off was not re-made either.
    expect(engine.liveCords).toEqual(['obj-1:0>obj-2:0']);
  });

  itWithSpecs('a 20-frame drag through a real document rebuilds nothing', async () => {
    const { doc, engine } = await live();
    const osc = doc.addBox('cycle~ 440', 40, 40);
    const amp = doc.addBox('*~ 0.2', 40, 120);
    doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });
    const before = engine.getNode(osc.id)!;
    expect(before).toBeDefined();

    for (let i = 0; i < 20; i++) doc.moveNodes([osc.id], 4, 2, true);

    expect(engine.getNode(osc.id)).toBe(before);
    expect(engine.liveCords).toEqual(docCords(doc));
  });
});

describe('cords are added and removed symmetrically', () => {
  itWithSpecs('the engine names exactly the cords the document names', async () => {
    const { doc, engine } = await live();
    const src = doc.addBox('unpack 1 2 3', 40, 40);
    const a = doc.addBox('print a', 40, 140);
    const b = doc.addBox('print b', 160, 140);
    const c = doc.addBox('print c', 280, 140);
    expect(doc.node(src.id)!.numOutlets).toBe(3);

    doc.addEdge({ id: src.id, outlet: 0 }, { id: a.id, inlet: 0 });
    doc.addEdge({ id: src.id, outlet: 1 }, { id: b.id, inlet: 0 });
    doc.addEdge({ id: src.id, outlet: 2 }, { id: c.id, inlet: 0 });
    expect(engine.liveCords.sort()).toEqual(docCords(doc));
    expect(engine.liveCords).toHaveLength(3);

    // Shrinking the arity orphans the third cord. The document drops it in the same
    // transaction as the retype, so the engine must end up carrying exactly two.
    doc.setBoxText(src.id, 'unpack 1 2');
    expect(doc.node(src.id)!.numOutlets).toBe(2);
    expect(engine.liveCords.sort()).toEqual(docCords(doc));
    expect(engine.liveCords).toHaveLength(2);

    // Growing it back does not resurrect the cord (Max does not either), and still agrees.
    doc.setBoxText(src.id, 'unpack 1 2 3 4');
    expect(engine.liveCords.sort()).toEqual(docCords(doc));

    doc.removeNodes([src.id]);
    expect(engine.liveCords).toEqual([]);
  });

  itWithSpecs('one undo of a delete restores the box AND every cord, in the engine too', async () => {
    const { doc, engine } = await live();
    const src = doc.addBox('counter 0 9', 40, 40);
    const sink = doc.addBox('counter 0 9', 40, 140);
    doc.addEdge({ id: src.id, outlet: 0 }, { id: sink.id, inlet: 0 });
    expect(engine.liveCords).toHaveLength(1);

    doc.removeNodes([src.id]);
    expect(engine.liveCords).toEqual([]);
    expect(engine.getNode(src.id)).toBeUndefined();

    doc.undo();
    expect(engine.getNode(src.id)).toBeDefined();
    expect(engine.liveCords.sort()).toEqual(docCords(doc));
  });
});

describe('disconnect() actually cuts the cord', () => {
  it('nothing crosses a cut control cord, and cutting it twice is honest', () => {
    const engine = new Engine(newCtx());
    const edge = cord('obj-1', 0, 'obj-2', 0, 'control');
    const report = engine.build(patchOf([
      node('obj-1', 'counter', ['control'], [0, 99]),
      node('obj-2', 'counter', ['control'], [0, 99]),
    ], [edge]));

    const heard: Msg[] = [];
    report.built.get('obj-2')!.onControlOut!(0, (m) => heard.push(m));
    report.built.get('obj-1')!.controlIns![0]!(['bang']);
    expect(heard, 'the cord was never wired in the first place').toHaveLength(1);

    expect(engine.disconnect(edge)).toBe(true);
    report.built.get('obj-1')!.controlIns![0]!(['bang']);
    expect(heard.length, 'a message crossed a cord that was cut').toBe(1);

    // The second call has nothing to cut and must say so rather than silently succeed.
    expect(engine.disconnect(edge)).toBe(false);
    expect(engine.liveCords).toEqual([]);
  });

  it('a cut signal cord is unwired from the Web Audio graph, not merely forgotten', () => {
    const engine = new Engine(newCtx());
    const edge = cord('obj-1', 0, 'obj-2', 0, 'signal');
    const report = engine.build(patchOf([
      node('obj-1', 'cycle~', ['signal'], [440]),
      node('obj-2', 'ezdac~', []),
    ], [edge]));
    const out = report.built.get('obj-1')!.signalOuts[0] as AudioNode;
    const inn = report.built.get('obj-2')!.signalIns[0] as AudioNode;
    const spy = vi.spyOn(out, 'disconnect');

    expect(engine.disconnect(edge)).toBe(true);

    // With the destination, not bare: a bare disconnect() would also drop cords this
    // edit never touched, and a teardown that only deleted the Map entry would leave
    // the oscillator audible through a cord the canvas no longer draws.
    expect(calledWith(spy, inn), 'the cord was not unwired from its destination').toBe(true);
  });

  it('a video cord stops being pumped', () => {
    const engine = new Engine(newCtx());
    const edge = cord('obj-1', 0, 'obj-2', 0, 'video');
    const report = engine.build(patchOf([
      node('obj-1', 'jit.grab', ['video', 'control']),
      node('obj-2', 'jit.matrix', ['video', 'control']),
    ], [edge]));
    expect(report.videoCords).toBe(1);

    expect(engine.disconnect(edge)).toBe(true);
    expect(engine.liveCords).toEqual([]);
    // The pump reads videoEdges; the only way to see it is emptied from out here is that
    // a rebuild of the same cord reports one, not two.
    expect(engine.connect(edge)).toBe(true);
    expect(engine.liveCords).toEqual(['obj-1:0>obj-2:0']);
  });
});

describe('removeNode takes its cords and its subscriptions with it', () => {
  it('deleting a receive leaves nothing listening on its bus', () => {
    const engine = new Engine(newCtx());
    const report = engine.build(patchOf([
      node('obj-1', 'send', [], ['chan']),
      node('obj-2', 'receive', ['control'], ['chan']),
    ]));
    const send = report.built.get('obj-1')!;
    const recv = report.built.get('obj-2')!;
    const heard: Msg[] = [];
    recv.onControlOut!(0, (m) => heard.push(m));
    send.controlIns![0]!([1]);
    expect(heard).toEqual([[1]]);

    engine.removeNode('obj-2');
    send.controlIns![0]!([2]);

    // receive's own dispose() unsubscribes; removeNode must call it. A bus-wide reset
    // would be the wrong cure — it would deafen every other patch on the page.
    expect(heard).toEqual([[1]]);
    expect(buses.clear).toBeTypeOf('function'); // the shared bus registry still exists
  });

  it('deleting a box cuts every cord touching it, both directions', () => {
    const engine = new Engine(newCtx());
    const engineNodes = [
      node('obj-1', 'counter', ['control'], [0, 9]),
      node('obj-2', 'counter', ['control'], [0, 9]),
      node('obj-3', 'counter', ['control'], [0, 9]),
    ];
    engine.build(patchOf(engineNodes, [
      cord('obj-1', 0, 'obj-2', 0, 'control'),
      cord('obj-2', 0, 'obj-3', 0, 'control'),
    ]));
    expect(engine.liveCords).toHaveLength(2);

    engine.removeNode('obj-2');

    expect(engine.liveCords).toEqual([]);
    expect(engine.getNode('obj-1')).toBeDefined();
    expect(engine.getNode('obj-3')).toBeDefined();
  });
});

describe('renumber is a rename and nothing else', () => {
  it('every live object survives, and its cords move to the new keys', () => {
    const engine = new Engine(newCtx());
    const control = cord('obj-1', 0, 'obj-2', 0, 'control');
    const video = cord('obj-3', 0, 'obj-4', 0, 'video');
    const report = engine.build(patchOf([
      node('obj-1', 'counter', ['control'], [0, 9]),
      node('obj-2', 'counter', ['control'], [0, 9]),
      node('obj-3', 'jit.grab', ['video', 'control']),
      node('obj-4', 'jit.matrix', ['video', 'control']),
    ], [control, video]));
    const live: Record<string, MaxNode> = {};
    for (const [id, n] of report.built) live[id] = n;
    const disposed = vi.fn();
    for (const n of Object.values(live)) (n as { dispose?: () => void }).dispose = disposed;

    // reorder() at save/codegen time: a pure permutation of the ids.
    const map = { 'obj-1': 'obj-4', 'obj-2': 'obj-3', 'obj-3': 'obj-2', 'obj-4': 'obj-1' };
    const edgeMap = {
      'obj-1:0>obj-2:0': 'obj-4:0>obj-3:0',
      'obj-3:0>obj-4:0': 'obj-2:0>obj-1:0',
    };
    engine.applyOps([{ t: 'renumber', map, edgeMap }], {} as unknown as PatchDoc);

    for (const [from, to] of Object.entries(map)) {
      expect(engine.getNode(to), `${from} was re-instantiated as ${to}`).toBe(live[from]);
    }
    expect(disposed, 'a rename disposed something').not.toHaveBeenCalled();
    expect(engine.liveCords.sort()).toEqual(['obj-2:0>obj-1:0', 'obj-4:0>obj-3:0']);

    // The cord really moved: it is cuttable under the new name and gone under the old.
    expect(engine.disconnect(cord('obj-1', 0, 'obj-2', 0, 'control'))).toBe(false);
    expect(engine.disconnect(cord('obj-4', 0, 'obj-3', 0, 'control'))).toBe(true);
    // …and the renamed VIDEO cord's teardown was re-derived against its new key, which
    // is the one teardown that closes over the key it is filed under.
    expect(engine.disconnect(cord('obj-2', 0, 'obj-1', 0, 'video'))).toBe(true);
    expect(engine.liveCords).toEqual([]);
  });

  itWithSpecs('doc.reorder() through the live feed keeps the patch playing', async () => {
    const { doc, engine } = await live();
    const a = doc.addBox('counter 0 9', 40, 40);
    const b = doc.addBox('counter 0 9', 40, 140);
    doc.removeNodes([doc.addBox('print gone', 300, 40).id]); // leaves a gap in the ids
    doc.addEdge({ id: a.id, outlet: 0 }, { id: b.id, inlet: 0 });
    const liveA = engine.getNode(a.id)!;
    const liveB = engine.getNode(b.id)!;

    doc.reorder();

    const [newA, newB] = [...doc.nodes()].map((n) => n.id);
    expect(newA).toBe('obj-1'); // densified, which is the whole point of reorder()
    expect(engine.getNode(newA)).toBe(liveA);
    expect(engine.getNode(newB)).toBe(liveB);
    expect(engine.liveCords.sort()).toEqual(docCords(doc));
  });
});

describe('clear() cuts the cords before it disposes the objects', () => {
  it('the signal chain is unwired, not merely dropped', () => {
    const engine = new Engine(newCtx());
    const report = engine.build(patchOf([
      node('obj-1', 'cycle~', ['signal'], [440]),
      node('obj-2', 'ezdac~', []),
    ], [cord('obj-1', 0, 'obj-2', 0, 'signal')]));
    const out = report.built.get('obj-1')!.signalOuts[0] as AudioNode;
    const inn = report.built.get('obj-2')!.signalIns[0] as AudioNode;
    const spy = vi.spyOn(out, 'disconnect');

    engine.clear();

    // Dropping the teardown thunks unrun (what clear() used to do) left this chain wired
    // to ctx.destination for the life of the page: File > New kept playing, and each
    // Open stacked another audible copy on top. The argument matters — an object's own
    // dispose() calls a BARE disconnect(), so only the targeted call proves the cord was
    // cut rather than the node merely tidied.
    expect(calledWith(spy, inn), 'the cleared patch is still wired to its dac').toBe(true);
    expect(engine.liveCords).toEqual([]);
  });

  it('a throwing teardown does not strand the remaining cords', () => {
    const engine = new Engine(newCtx());
    const report = engine.build(patchOf([
      node('obj-1', 'cycle~', ['signal'], [440]),
      node('obj-2', 'cycle~', ['signal'], [660]),
      node('obj-3', 'ezdac~', []),
    ], [
      cord('obj-1', 0, 'obj-3', 0, 'signal'),
      cord('obj-2', 0, 'obj-3', 1, 'signal'),
    ]));
    const first = report.built.get('obj-1')!.signalOuts[0] as AudioNode;
    const second = report.built.get('obj-2')!.signalOuts[0] as AudioNode;
    const secondIn = report.built.get('obj-3')!.signalIns[1] as AudioNode;
    // Web Audio throws InvalidAccessError when the connection is already gone, which a
    // node's own dispose() is entitled to have done first.
    vi.spyOn(first, 'disconnect').mockImplementation(() => {
      throw new DOMException('InvalidAccessError');
    });
    const spy = vi.spyOn(second, 'disconnect');

    expect(() => engine.clear()).not.toThrow();
    expect(calledWith(spy, secondIn), 'one throwing teardown stranded the rest').toBe(true);
  });
});
