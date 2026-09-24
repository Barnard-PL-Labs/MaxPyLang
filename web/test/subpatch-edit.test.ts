// Editing inside a `p` box — PatchDoc.openSubpatch() and the `sub` op.
//
// What the patcher promises when you open a subpatcher and change it:
//
//   • WRITE-BACK. The edit is in the parent box's `patcher` dict the moment it is made,
//     so a save of the TOP document — which is all Save, Share, autosave and codegen
//     ever write — carries it. Two levels deep too.
//   • PORTS FOLLOW THE INSIDE. Adding, removing or reordering an inner inlet/outlet
//     changes the box's ports, and a cord on a port that went away goes with it, in the
//     same undo step.
//   • ONE HISTORY. Each inner edit is one entry on the top document's stack; undo from
//     the parent replays into an open subpatcher; undo INSIDE only reaches edits made
//     there; drags and typed boxes coalesce into one step exactly as at the top level.
//   • THE AUDIO FOLLOWS WITHOUT A REBUILD. The engine forwards the inner ops to the
//     nested engine the box runs on: the box's node is the same object afterwards, and
//     messages go through the edited inner patch.

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects';
import { PatchDoc } from '../src/doc/patch-doc';
import { Engine, edgeKey } from '../src/engine/engine';
import { loadBoxSpecs } from '../src/ir/objectspec';
import { parseMaxPat } from '../src/parser/maxpat';
import { patchToMaxPat } from '../src/parser/write-maxpat';
import type { Msg } from '../src/runtime/atoms';

const specsPresent = existsSync(fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)));
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

type Box = Record<string, unknown>;
const box = (id: string, x: number, fields: Box): { box: Box } => ({
  box: { id, patching_rect: [x, 100, 40, 20], numinlets: 1, numoutlets: 1, outlettype: [''], ...fields },
});
const line = (from: string, outlet: number, to: string, inlet: number) => ({
  patchline: { source: [from, outlet], destination: [to, inlet] },
});

/** Inner patch: inlet -> outlet, a straight relay. */
const relay = () => ({
  boxes: [
    box('obj-1', 20, { maxclass: 'inlet', numinlets: 0 }),
    box('obj-2', 20, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
  ],
  lines: [line('obj-1', 0, 'obj-2', 0)],
});

/**
 * Top level: a message box -> `p relay` -> a `print`-ish sink we can listen to (another
 * `+ 0`, whose outlet the test subscribes to on the engine).
 */
function topPatch(inner: unknown = relay()) {
  return parseMaxPat({
    patcher: {
      boxes: [
        box('obj-1', 10, { maxclass: 'newobj', text: '+ 0', numinlets: 2 }),
        box('obj-2', 10, {
          maxclass: 'newobj',
          text: 'p relay',
          numinlets: 1,
          numoutlets: 1,
          patcher: inner,
        }),
        box('obj-3', 10, { maxclass: 'newobj', text: '+ 0', numinlets: 2 }),
      ],
      lines: [line('obj-1', 0, 'obj-2', 0), line('obj-2', 0, 'obj-3', 0)],
    },
  });
}

/** The boxes of the `patcher` dict a saved top document has inside box `id`. */
function savedInner(doc: PatchDoc, id = 'obj-2'): { boxes: { box: Box }[]; lines: unknown[] } {
  const saved = patchToMaxPat(doc) as { patcher: { boxes: { box: Box }[] } };
  const p = saved.patcher.boxes.find((b) => b.box.id === id)!.box;
  return p.patcher as { boxes: { box: Box }[]; lines: unknown[] };
}

const texts = (inner: { boxes: { box: Box }[] }) => inner.boxes.map((b) => String(b.box.text ?? b.box.maxclass));

describe('openSubpatch: write-back', () => {
  itWithSpecs('an edit inside lands in the parent box and in a save of the top document', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    expect([...inside.nodes()].map((n) => n.className)).toEqual(['inlet', 'outlet']);

    inside.addBox('+ 1', 60, 40);

    expect(texts(savedInner(top))).toContain('+ 1');
    // One edit, one entry — on the TOP stack.
    expect(top.canUndo).toBe(true);
    expect(top.undoLabel).toBe('Add +');
    expect(inside.canUndo).toBe(true);
  });

  itWithSpecs('reaches two levels down', async () => {
    const innermost = relay();
    const top = await PatchDoc.open(
      topPatch({
        boxes: [
          box('obj-1', 20, { maxclass: 'inlet', numinlets: 0 }),
          box('obj-5', 20, { maxclass: 'newobj', text: 'p inner', patcher: innermost }),
          box('obj-2', 20, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
        ],
        lines: [line('obj-1', 0, 'obj-5', 0), line('obj-5', 0, 'obj-2', 0)],
      })
    );
    const mid = top.openSubpatch('obj-2');
    const deep = mid.openSubpatch('obj-5');
    deep.addBox('* 10', 80, 40);

    const midSaved = savedInner(top).boxes.find((b) => b.box.id === 'obj-5')!.box;
    expect(texts(midSaved.patcher as { boxes: { box: Box }[] })).toContain('* 10');

    top.undo();
    expect([...deep.nodes()].map((n) => n.text)).not.toContain('* 10');
    const after = savedInner(top).boxes.find((b) => b.box.id === 'obj-5')!.box;
    expect(texts(after.patcher as { boxes: { box: Box }[] })).not.toContain('* 10');
  });

  itWithSpecs('works on a `p` typed on the canvas, with nothing inside yet', async () => {
    const top = await PatchDoc.create();
    const p = top.addBox('p fresh', 40, 40);
    const inside = top.openSubpatch(p.id);
    expect(inside.nodeCount).toBe(0);
    inside.addBox('inlet', 20, 20);
    const saved = top.node(p.id)!.raw!.patcher as { boxes: unknown[]; fileversion?: number };
    expect(saved.boxes).toHaveLength(1);
    // A real patcher dict, header and all, so Max opens the saved box.
    expect(saved.fileversion).toBe(1);
    expect(top.node(p.id)!.numInlets).toBe(1);
  });
});

describe('openSubpatch: the box’s ports follow its inlets and outlets', () => {
  itWithSpecs('adding an inlet adds a port; removing it takes its cord, and one undo brings both back', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    expect(top.node('obj-2')!.numInlets).toBe(1);

    // To the LEFT of the existing inlet, so it becomes port 0 and the old one port 1.
    const added = inside.addBox('inlet', 0, 20);
    expect(top.node('obj-2')!.numInlets).toBe(2);
    // The outer cord keeps its port index, as in Max when an inlet is inserted.
    expect(top.edgesOf('obj-2').map(edgeKey).sort()).toEqual(['obj-1:0>obj-2:0', 'obj-2:0>obj-3:0']);

    inside.removeNodes([added.id]);
    expect(top.node('obj-2')!.numInlets).toBe(1);

    // Now remove the ONLY inlet: the port goes, and so does the cord on it.
    inside.removeNodes(['obj-1']);
    expect(top.node('obj-2')!.numInlets).toBe(0);
    expect(top.edgesOf('obj-2').map(edgeKey)).toEqual(['obj-2:0>obj-3:0']);

    // One step, from inside: the inlet, its inner cord, the port and the outer cord.
    inside.undo();
    expect(inside.node('obj-1')?.className).toBe('inlet');
    expect(inside.edgeCount).toBe(1);
    expect(top.node('obj-2')!.numInlets).toBe(1);
    expect(top.edgesOf('obj-2').map(edgeKey).sort()).toEqual(['obj-1:0>obj-2:0', 'obj-2:0>obj-3:0']);
  });

  itWithSpecs('an outlet fed a signal makes the box outlet a signal outlet', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    const osc = inside.addBox('cycle~ 440', 100, 20);
    const out = inside.addBox('outlet', 100, 200);
    expect(top.node('obj-2')!.numOutlets).toBe(2);
    expect(top.node('obj-2')!.outletDomains).toEqual(['control', 'control']);
    inside.addEdge({ id: osc.id, outlet: 0 }, { id: out.id, inlet: 0 });
    expect(top.node('obj-2')!.outletDomains).toEqual(['control', 'signal']);
    expect(top.node('obj-2')!.outletTypes).toEqual(['', 'signal']);
    const saved = (patchToMaxPat(top) as { patcher: { boxes: { box: Box }[] } }).patcher.boxes[1].box;
    expect(saved.numoutlets).toBe(2);
    expect(saved.outlettype).toEqual(['', 'signal']);
  });
});

describe('openSubpatch: one undo history', () => {
  itWithSpecs('undo from the parent replays into the open subpatcher, and redo does too', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    const seen: string[] = [];
    inside.on((ops, source) => seen.push(`${source}:${ops.map((o) => o.t).join(',')}`));

    const added = inside.addBox('+ 1', 60, 40);
    top.undo();
    expect(inside.node(added.id)).toBeUndefined();
    top.redo();
    expect(inside.node(added.id)?.text).toBe('+ 1');
    expect(seen).toEqual(['apply:add-node', 'undo:remove-node', 'redo:add-node']);
  });

  itWithSpecs('undo inside reaches only edits made inside', async () => {
    const top = await PatchDoc.open(topPatch());
    top.addBox('+ 5', 200, 200); // a top-level edit, made before opening
    const inside = top.openSubpatch('obj-2');
    expect(inside.canUndo).toBe(false);
    inside.undo(); // must not undo the top-level `+ 5` the user cannot see
    expect(top.nodeCount).toBe(4);

    inside.addBox('+ 1', 60, 40);
    expect(inside.canUndo).toBe(true);
    inside.undo();
    expect(inside.nodeCount).toBe(2);
    expect(inside.canUndo).toBe(false);
    expect(inside.canRedo).toBe(true);
    inside.redo();
    expect(inside.nodeCount).toBe(3);
  });

  itWithSpecs('a drag inside is one undo step, and a second drag is another', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    const start = inside.node('obj-2')!.rect;
    for (let i = 0; i < 10; i++) inside.moveNodes(['obj-2'], 3, 1, true);
    inside.endCoalesce();
    for (let i = 0; i < 5; i++) inside.moveNodes(['obj-2'], 2, 0, true);
    inside.endCoalesce();

    top.undo();
    expect(inside.node('obj-2')!.rect[0]).toBe(start[0] + 30);
    top.undo();
    expect(inside.node('obj-2')!.rect).toEqual(start);
    expect(inside.canUndo).toBe(false);
  });

  itWithSpecs('typing a box inside (empty box, then its text) is one undo step', async () => {
    const top = await PatchDoc.open(topPatch());
    const inside = top.openSubpatch('obj-2');
    const box = inside.addBox('', 40, 40);
    inside.mergeNext('New + ');
    inside.setBoxText(box.id, '+ 3');
    expect(top.undoLabel).toBe('New + ');
    inside.undo();
    expect(inside.node(box.id)).toBeUndefined();
    expect(inside.canUndo).toBe(false);
  });

  itWithSpecs('an undo that reaches the subpatcher while it is closed still restores the box', async () => {
    const top = await PatchDoc.open(topPatch());
    const before = JSON.stringify(savedInner(top));
    const inside = top.openSubpatch('obj-2');
    inside.addBox('+ 1', 60, 40);
    inside.close();
    top.undo();
    expect(JSON.stringify(savedInner(top))).toBe(before);
    // Reopening builds from the box as it now stands.
    expect(top.openSubpatch('obj-2').nodeCount).toBe(2);
  });
});

// ── the engine ───────────────────────────────────────────────────────────────

const ctx = () => new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

/** A top engine following `top`, with a tap on obj-3's outlet. */
function live(top: PatchDoc) {
  const engine = new Engine(ctx());
  engine.build(top.toIR());
  top.on((ops) => engine.applyOps(ops, top));
  const heard: Msg[] = [];
  engine.getNode('obj-3')!.onControlOut!(0, (m) => heard.push(m));
  const send = (m: Msg, inlet = 0) => engine.getNode('obj-2')!.controlIns![inlet]!(m);
  return { engine, heard, send };
}

describe('openSubpatch: the running engine follows without a rebuild', () => {
  itWithSpecs('re-routing inside changes what comes out, and the box is the same object', async () => {
    const top = await PatchDoc.open(topPatch());
    const { engine, heard, send } = live(top);
    const pNode = engine.getNode('obj-2');
    send([5]);
    expect(heard).toEqual([[5]]);

    const inside = top.openSubpatch('obj-2');
    inside.removeEdge('obj-1:0>obj-2:0');
    const add = inside.addBox('+ 100', 20, 60);
    inside.addEdge({ id: 'obj-1', outlet: 0 }, { id: add.id, inlet: 0 });
    inside.addEdge({ id: add.id, outlet: 0 }, { id: 'obj-2', inlet: 0 });

    send([5]);
    expect(heard).toEqual([[5], [105]]);
    expect(engine.getNode('obj-2')).toBe(pNode);
    // The nested engine is what a canvas showing the inside mounts widgets from.
    expect(pNode!.subpatch!.engine.getNode(add.id)).toBeDefined();

    top.undo(); // the last cord
    send([5]);
    expect(heard).toEqual([[5], [105]]);
    top.undo();
    top.undo();
    top.undo(); // back to the straight relay
    send([7]);
    expect(heard).toEqual([[5], [105], [7]]);
  });

  itWithSpecs('a new inlet is a new live port, with the outer cords rewired to the right relays', async () => {
    const top = await PatchDoc.open(topPatch());
    const { engine, heard, send } = live(top);
    const inside = top.openSubpatch('obj-2');
    // A second inlet to the RIGHT, feeding the same outlet.
    const inlet = inside.addBox('inlet', 200, 20);
    inside.addEdge({ id: inlet.id, outlet: 0 }, { id: 'obj-2', inlet: 0 });
    expect(engine.getNode('obj-2')!.controlIns).toHaveLength(2);

    send([1], 0);
    send([2], 1);
    expect(heard).toEqual([[1], [2]]);
    // The outer engine carries exactly the cords the document has.
    expect(engine.liveCords.sort()).toEqual([...top.edges()].map(edgeKey).sort());
  });
});
