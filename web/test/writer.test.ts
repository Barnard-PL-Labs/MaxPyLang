// src/parser/write-maxpat.ts — the fidelity tests.
//
// The writer's claim is not "Max can open this" but "a file this produces loses nothing
// from a file real Max produced", so these are preservation tests rather than formatting
// ones. Four things carry that claim and each gets its own case here:
//
//   1. A box arrives with keys the IR has no field for — bgcolor, presentation_rect,
//      saved_object_attributes, and (standing in for whatever a future Max version
//      invents) a key nobody has ever written. All of them must come back untouched.
//   2. `outlettype` must come from the COMPUTED tokens, never from the box we copied.
//      Shrinking `unpack 1 2 3` to `unpack 1 2` and leaving the third entry behind gives
//      Max a phantom outlet you can draw a cord to.
//   3. `text` follows Max's conventions, which differ per class: a message box's text is
//      its contents with no class prefix, a comment keeps its prose, and a UI box such as
//      ezdac~ must not acquire one it never had.
//   4. The patcher header really is the 34 keys Max writes.
//
// The three-layer round-trip property suite over the bundled corpus lives elsewhere;
// this file is the unit level, plus one end-to-end parse -> write -> parse to prove the
// pieces compose.

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMaxPat } from '../src/parser/maxpat';
import { EMPTY_PATCHER_HEADER, nodeToBox, patchToMaxPat } from '../src/parser/write-maxpat';
import { loadBoxSpecs, resolveBox, specToNode } from '../src/ir/objectspec';
import { PatchDoc } from '../src/doc/patch-doc';
import type { IRNode, IRPatch } from '../src/ir/types';

/** The shape patchToMaxPat returns. It is declared `unknown` so callers can't assume. */
interface MaxPatFile {
  patcher: Record<string, unknown> & {
    boxes: { box: Record<string, unknown> }[];
    lines: { patchline: Record<string, unknown> }[];
  };
}

const write = (patch: IRPatch, opts?: Parameters<typeof patchToMaxPat>[1]) =>
  patchToMaxPat(patch, opts) as MaxPatFile;

function loadSample(name: string): unknown {
  const path = fileURLToPath(new URL(`../public/test-patches/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** maxpylang's template lives outside this package; a checkout without it just skips. */
const templatePath = fileURLToPath(
  new URL('../../maxpylang/data/PATCH_TEMPLATES/empty_template.json', import.meta.url),
);
const itWithTemplate = it.skipIf(!existsSync(templatePath));

/** boxspecs.json is generated and committed; a fresh checkout may not have run gen yet. */
const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

/**
 * A minimal box dict, spelled the way Max spells one — `outlettype` present exactly when
 * the box has outlets. Cases pass only the keys they care about.
 */
function boxDict(maxclass: string, text: string, over: Record<string, unknown> = {}) {
  const dict: Record<string, unknown> = {
    id: 'obj-1',
    maxclass,
    numinlets: 1,
    numoutlets: 1,
    outlettype: [''],
    patching_rect: [0, 0, 60, 22],
    text,
    ...over,
  };
  if (dict.numoutlets === 0) delete dict.outlettype;
  return dict;
}

/** Wrap bare box/patchline dicts into the patcher shape the parser reads. */
function parseBoxes(boxes: Record<string, unknown>[], lines: Record<string, unknown>[] = []) {
  return parseMaxPat({
    patcher: {
      boxes: boxes.map((dict) => ({ box: dict })),
      lines: lines.map((patchline) => ({ patchline })),
    },
  });
}

describe('nodeToBox — preservation', () => {
  // The box below is the whole argument for IRNode.raw. Every key after patching_rect is
  // something this app has no concept of; a writer that rebuilt the box from the IR's
  // fields would delete the lot, and the user would find their patch restyled, their
  // presentation layout gone and their vst~ unloaded.
  const decorated = {
    id: 'obj-9',
    maxclass: 'newobj',
    numinlets: 2,
    numoutlets: 1,
    outlettype: ['signal'],
    patching_rect: [100, 200, 43, 22],
    text: 'cycle~ 440',
    bgcolor: [0.2, 0.3, 0.4, 1.0],
    presentation: 1,
    presentation_rect: [10, 20, 43, 22],
    varname: 'osc',
    parameter_enable: 1,
    fontsize: 14.0,
    saved_object_attributes: { parameter_enable: 1, parameter_mappable: 0 },
    zzz_future_key: { invented: ['by', 'a', 'later', 'Max'], depth: [[1, 2], [3, 4]] },
  };

  it('carries every key the IR has no field for through untouched', () => {
    const patch = parseBoxes([decorated]);
    const box = nodeToBox(patch.nodes[0]);

    for (const key of [
      'bgcolor',
      'presentation',
      'presentation_rect',
      'varname',
      'parameter_enable',
      'fontsize',
      'saved_object_attributes',
      'zzz_future_key',
    ] as const) {
      expect(box[key], key).toEqual(decorated[key]);
    }
    // Nothing was dropped and nothing was invented: same keys, same JSON.
    expect(Object.keys(box).sort()).toEqual(Object.keys(decorated).sort());
    expect(JSON.parse(JSON.stringify(box))).toEqual(JSON.parse(JSON.stringify(decorated)));
  });

  it('survives a full parse -> write -> parse cycle', () => {
    const box = write(parseBoxes([decorated])).patcher.boxes[0].box;
    expect(JSON.parse(JSON.stringify(box))).toEqual(JSON.parse(JSON.stringify(decorated)));
  });

  it('lets the IR win on the keys it owns', () => {
    const patch = parseBoxes([decorated]);
    const node = patch.nodes[0];
    const moved: IRNode = { ...node, id: 'obj-42', rect: [7, 8, 60, 22], numInlets: 3 };
    const box = nodeToBox(moved);

    expect(box.id).toBe('obj-42');
    expect(box.patching_rect).toEqual([7, 8, 60, 22]);
    expect(box.numinlets).toBe(3);
    // ...while a neighbouring key the IR does not own is still the original.
    expect(box.varname).toBe('osc');
  });

  it('does not alias the node it was given', () => {
    const patch = parseBoxes([decorated]);
    const node = patch.nodes[0];
    const box = nodeToBox(node);
    (box.patching_rect as number[])[0] = -1;
    expect(node.rect[0]).toBe(100);
  });
});

describe('nodeToBox — outlettype comes from the computed tokens', () => {
  const unpack3 = {
    id: 'obj-1',
    maxclass: 'newobj',
    numinlets: 1,
    numoutlets: 3,
    outlettype: ['int', 'int', 'int'],
    patching_rect: [0, 0, 70, 22],
    text: 'unpack 1 2 3',
  };

  it('writes the stale third entry away when the box loses an outlet', () => {
    const node = parseBoxes([unpack3]).nodes[0];
    // What PatchDoc.setBoxText does when the text becomes `unpack 1 2`.
    const shrunk: IRNode = {
      ...node,
      args: [1, 2],
      text: 'unpack 1 2',
      numOutlets: 2,
      outletTypes: ['int', 'int'],
      outletDomains: ['control', 'control'],
    };

    const box = nodeToBox(shrunk);
    expect(box.numoutlets).toBe(2);
    expect(box.outlettype).toEqual(['int', 'int']);
    // The proof that it did not come from the box we copied:
    expect((node.raw as Record<string, unknown>).outlettype).toEqual(['int', 'int', 'int']);
  });

  itWithSpecs('agrees with resolveBox when the arity rules recompute it', () => {
    const node = parseBoxes([unpack3]).nodes[0];
    const spec = resolveBox('unpack 1 2');
    const box = nodeToBox({ ...specToNode(spec, node.id), raw: node.raw });

    expect(box.numoutlets).toBe(2);
    expect((box.outlettype as string[]).length).toBe(2);
  });

  it('drops outlettype entirely when the box has no outlets, as Max does', () => {
    // Verified against the 1093 boxes of the hand-built patches in examples/: the key is
    // present exactly when numoutlets > 0, and is always numoutlets long.
    const node = parseBoxes([unpack3]).nodes[0];
    const box = nodeToBox({ ...node, numOutlets: 0, outletTypes: [], outletDomains: [] });
    expect('outlettype' in box).toBe(false);
  });

  it('pads a hand-built node that never had tokens', () => {
    const node: IRNode = {
      id: 'obj-1',
      className: 'jit.movie',
      args: [],
      maxclass: 'newobj',
      numInlets: 1,
      numOutlets: 2,
      outletDomains: ['video', 'control'],
      rect: [0, 0, 60, 22],
      text: 'jit.movie',
    };
    expect(nodeToBox(node).outlettype).toEqual(['jit_matrix', '']);
  });

  it('pads a SHORT outlettype with "", the token Max uses for an untyped outlet', () => {
    // The fallback above is already numOutlets long, so it never reaches the per-entry
    // pad. This does: the parser copies `outlettype` verbatim (maxpat.ts), so a box
    // whose array is shorter than `numoutlets` — or missing while numoutlets > 0 — comes
    // through short and the writer has to fill the gap. The VALUE matters, not just the
    // length: "" is an untyped (bang/int/list) outlet, and inventing "signal" there
    // would make the next parse read a control cord as a signal one and the engine wire
    // it through Web Audio instead of the control bus.
    const short = parseBoxes([
      boxDict('newobj', 'route 1 2', { numinlets: 1, numoutlets: 2, outlettype: ['signal'] }),
    ]).nodes[0];
    expect(short.outletTypes).toEqual(['signal']); // the parser did not pad it
    expect(nodeToBox(short).outlettype).toEqual(['signal', '']);

    const none = parseBoxes([
      boxDict('newobj', 'unpack 1 2', { numinlets: 1, numoutlets: 2, outlettype: undefined }),
    ]).nodes[0];
    expect(nodeToBox(none).outlettype).toEqual(['', '']);
  });
});

describe('nodeToBox — text follows Max, not the IR field', () => {
  it('leaves a message box the text it arrived with, leading space and all', () => {
    // maxpylang's own form, from webcam_pixelated_synth.maxpat: a leading space and no
    // class name (text.py:get_text's `if self._name != "message"`). There is no class
    // prefix here to strip, so nothing is rewritten — the space is the authoring tool's
    // and Max reads the box identically with or without it. Stripping a prefix that IS
    // there is the next test.
    const node = parseBoxes([
      boxDict('message', ' 440', { numinlets: 2, patching_rect: [0, 0, 50, 22] }),
    ]).nodes[0];

    expect(nodeToBox(node).text).toBe(' 440');
    expect(nodeToBox(node, { maxpylangCompat: true }).text).toBe(' 440');
  });

  itWithSpecs('strips the class name a canvas-built message box keeps in its text', () => {
    // resolveBox('message 440') stores the line that was TYPED in spec.text, while its
    // args are already just [440]. Writing that line back would produce a message box
    // that sends the symbol "message" — the one place the two meanings of IRNode.text
    // actually bite.
    const node = specToNode(resolveBox('message 440'), 'obj-1');
    expect(node.text).toBe('message 440');
    expect(nodeToBox(node).text).toBe('440');
  });

  it('keeps a comment whose prose begins with its own class name', () => {
    const node = parseBoxes([
      boxDict('comment', 'comment your patches', { numoutlets: 0 }),
    ]).nodes[0];
    expect(nodeToBox(node).text).toBe('comment your patches');
  });

  it('keeps ordinary comment text', () => {
    const node = parseBoxes([
      boxDict('comment', 'lfo for panning', { numoutlets: 0 }),
    ]).nodes[0];
    expect(nodeToBox(node).text).toBe('lfo for panning');
  });

  itWithSpecs('does not give an ezdac~ a text key it never had', () => {
    // ezdac~'s default box in OBJ_INFO carries no `text`, and neither does any UI box in
    // the hand-built patches. A box built on the canvas must not gain one.
    const node = specToNode(resolveBox('ezdac~'), 'obj-1');
    const box = nodeToBox(node);
    expect(box.maxclass).toBe('ezdac~');
    expect('text' in box).toBe(false);
    // ...and maxpylang's writer does emit one, which is what the compat flag is for.
    expect(nodeToBox(node, { maxpylangCompat: true }).text).toBe('ezdac~');
  });

  itWithSpecs('gives a canvas-built box the default dict keys the IR has no field for', () => {
    const box = nodeToBox(specToNode(resolveBox('toggle'), 'obj-1'));
    expect(box.parameter_enable).toBe(0); // from boxspecs.json's default toggle
    expect(box.id).toBe('obj-1');
  });

  it('keeps a UI box text it arrived with when the contents distil to nothing', () => {
    // maxpylang writes the class name into every box's text. Blanking it would be a
    // silent edit of a file we did not author, and "" is not more correct than "toggle".
    const node = parseBoxes([
      boxDict('toggle', 'toggle', {
        outlettype: ['int'],
        parameter_enable: 0,
        patching_rect: [0, 0, 24, 24],
      }),
    ]).nodes[0];
    expect(nodeToBox(node).text).toBe('toggle');
  });

  it('writes an object box back atom for atom rather than normalizing it', () => {
    // The class name stays where it is — an object box names itself in its own text — and
    // so does everything else, double space included. Recomposing the line through
    // parseBoxText/formatBoxText would tidy that space away, and it is the tidying that
    // is the bug: it is the same code path that respells `33.` as `33.0`. Max tokenizes
    // on runs of whitespace, so the tidy-up changes nothing it reads and everything the
    // author typed.
    const messy = 'cycle~  @frequency 440';
    const node = parseBoxes([
      boxDict('newobj', messy, { numinlets: 2, outlettype: ['signal'] }),
    ]).nodes[0];
    expect(nodeToBox(node).text).toBe(messy);
  });

  it('keeps the two spellings only real Max writes: a bare `33.` and a comment newline', () => {
    // Both taken from the Max-saved patches under examples/, and both were being
    // rewritten before boxText stopped recomposing text it is not restructuring.
    // `33.` -> `33.0` is Python's str() showing through (formatArg appends the ".0" a
    // float literal needs in maxpylang's world); the comment is worse, because
    // collapsing its newlines reflows a numbered list into one paragraph AND renumbers
    // it — "1." is a float atom to the tokenizer.
    const lores = parseBoxes([
      boxDict('newobj', 'mc.lores~ 33. 0.5 @chans 32', {
        numinlets: 3,
        outlettype: ['multichannelsignal'],
      }),
    ]).nodes[0];
    expect(nodeToBox(lores).text).toBe('mc.lores~ 33. 0.5 @chans 32');

    const steps = '1. load in file\n2. generate the synth';
    const note = parseBoxes([boxDict('comment', steps, { numoutlets: 0 })]).nodes[0];
    expect(nodeToBox(note).text).toBe(steps);
  });
});

describe('patchlines', () => {
  const boxes = [
    boxDict('newobj', 'cycle~ 440', { numinlets: 2, outlettype: ['signal'] }),
    boxDict('newobj', '*~ 0.2', { id: 'obj-2', numinlets: 2, outlettype: ['signal'] }),
  ];

  it('omits midpoints for a straight cord and emits maxpylang shape on demand', () => {
    const patch = parseBoxes(boxes, [
      { destination: ['obj-2', 0], source: ['obj-1', 0], midpoints: [null] },
    ]);

    const plain = write(patch).patcher.lines[0].patchline;
    expect(plain).toEqual({ destination: ['obj-2', 0], source: ['obj-1', 0] });
    expect('midpoints' in plain).toBe(false);

    const compat = write(patch, { maxpylangCompat: true }).patcher.lines[0].patchline;
    expect(compat).toEqual({ destination: ['obj-2', 0], source: ['obj-1', 0], midpoints: [null] });
  });

  it('emits real midpoints in both modes', () => {
    // Real Max writes an even-length list of coordinates on a cord that bends; 4 and 8
    // entries are what the hand-built patches in examples/ contain.
    const bent = [20.5, 308.0, 66.0, 308.0];
    const patch = parseBoxes(boxes, [
      { destination: ['obj-2', 0], source: ['obj-1', 0], midpoints: bent },
    ]);
    expect(write(patch).patcher.lines[0].patchline.midpoints).toEqual(bent);
    expect(
      write(patch, { maxpylangCompat: true }).patcher.lines[0].patchline.midpoints,
    ).toEqual(bent);
  });

  it('omits the key for a cord that never had one', () => {
    const patch = parseBoxes(boxes, [{ destination: ['obj-2', 0], source: ['obj-1', 0] }]);
    expect('midpoints' in write(patch).patcher.lines[0].patchline).toBe(false);
    expect(write(patch, { maxpylangCompat: true }).patcher.lines[0].patchline.midpoints).toEqual([
      null,
    ]);
  });
});

describe('patchToMaxPat', () => {
  it('renumbers boxes densely and follows the cords along', () => {
    const patch = parseBoxes(
      [
        boxDict('newobj', 'cycle~ 440', { id: 'obj-17', outlettype: ['signal'] }),
        boxDict('newobj', '*~ 0.2', { id: 'obj-4', outlettype: ['signal'] }),
      ],
      [{ destination: ['obj-4', 0], source: ['obj-17', 0] }],
    );

    const out = write(patch, { renumber: true }).patcher;
    expect(out.boxes.map((b) => b.box.id)).toEqual(['obj-1', 'obj-2']);
    expect(out.lines[0].patchline).toEqual({ destination: ['obj-2', 0], source: ['obj-1', 0] });

    // The document's own ids are untouched: the engine and the undo stack still hold them.
    expect(patch.nodes.map((n) => n.id)).toEqual(['obj-17', 'obj-4']);
    // ...and without the flag, the sparse ids are what gets written.
    expect(write(patch).patcher.boxes.map((b) => b.box.id)).toEqual(['obj-17', 'obj-4']);
  });

  it('keeps the header the patch was opened with, and lets options override it', () => {
    const patch = parseMaxPat(loadSample('hello_world.maxpat'));
    const original = (loadSample('hello_world.maxpat') as { patcher: Record<string, unknown> })
      .patcher;

    const out = write(patch).patcher;
    const headerKeys = Object.keys(original).filter((k) => k !== 'boxes' && k !== 'lines');
    for (const key of headerKeys) expect(out[key], key).toEqual(original[key]);

    const resized = write(patch, { header: { rect: [0, 0, 640, 480] } }).patcher;
    expect(resized.rect).toEqual([0, 0, 640, 480]);
    expect(resized.default_fontname).toBe(original.default_fontname);
  });

  it('falls back to the empty-patcher header for a patch built from nothing', () => {
    const patch: IRPatch = { nodes: [], edges: [], byId: new Map() };
    const out = write(patch).patcher;
    expect(out.fileversion).toBe(1);
    expect(out.boxes).toEqual([]);
    expect(out.lines).toEqual([]);
    // boxes/lines go back where Max puts them: after the header, before its tail keys.
    const keys = Object.keys(out);
    expect(keys.indexOf('assistshowspatchername')).toBeLessThan(keys.indexOf('boxes'));
    expect(keys.indexOf('lines')).toBeLessThan(keys.indexOf('dependency_cache'));
  });

  it('accepts anything with toIR(), which is how PatchDoc reaches it', () => {
    const patch = parseMaxPat(loadSample('hello_world.maxpat'));
    const doc = { toIR: () => patch };
    expect(write(patch as IRPatch)).toEqual(patchToMaxPat(doc));
  });

  itWithSpecs('saves a document built on the canvas as a patch Max can open', () => {
    // The end of the Phase 2 path: nothing here came from a file, so every box dict is
    // the class's default with the IR-owned keys overlaid, and the message box is the
    // one whose text must lose its class name on the way out.
    const doc = PatchDoc.empty();
    const osc = doc.addBox('cycle~ 440', 40, 40);
    const amp = doc.addBox('*~ 0.2', 40, 100);
    const out = doc.addBox('ezdac~', 40, 160);
    const msg = doc.addBox('message 440', 200, 40);
    doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });
    doc.addEdge({ id: amp.id, outlet: 0 }, { id: out.id, inlet: 0 });

    const file = patchToMaxPat(doc, { renumber: true }) as MaxPatFile;
    const boxes = file.patcher.boxes.map((b) => b.box);

    expect(boxes.map((b) => b.id)).toEqual(['obj-1', 'obj-2', 'obj-3', 'obj-4']);
    expect(boxes[0].text).toBe('cycle~ 440');
    expect(boxes[0].outlettype).toEqual(['signal']);
    expect(boxes[0].patching_rect).toEqual([40, 40, ...(osc.rect.slice(2) as number[])]);
    expect('text' in boxes[2]).toBe(false); // the ezdac~
    expect(boxes[3].text).toBe('440'); // the message box, contents only
    expect(boxes[3].maxclass).toBe('message');
    expect(msg.text).toBe('message 440'); // ...and the document still holds the typed line
    expect(file.patcher.lines).toHaveLength(2);

    // It reads back as the same graph.
    const reread = parseMaxPat(file);
    expect(reread.nodes.map((n) => n.className)).toEqual([
      'cycle~',
      '*~',
      'ezdac~',
      'message',
    ]);
    expect(reread.edges.map((e) => [e.from.id, e.to.id, e.domain])).toEqual([
      ['obj-1', 'obj-2', 'signal'],
      ['obj-2', 'obj-3', 'signal'],
    ]);
  });

  it('round-trips every bundled patch back to the same graph', () => {
    const names = ['hello_world.maxpat', 'fm_synth.maxpat', 'webcam_pixelated_synth.maxpat'];
    for (const name of names) {
      const before = parseMaxPat(loadSample(name));
      const after = parseMaxPat(patchToMaxPat(before, { maxpylangCompat: true }));

      expect(after.nodes.map((n) => [n.id, n.className, n.args, n.numInlets, n.numOutlets]), name)
        .toEqual(before.nodes.map((n) => [n.id, n.className, n.args, n.numInlets, n.numOutlets]));
      expect(after.edges, name).toEqual(before.edges);
    }
  });

  it('reproduces every maxpylang-written file exactly under maxpylangCompat', () => {
    // The parity claim: for a file maxpylang wrote, this writer's compat mode is the
    // identity — across all 14 bundled patches, not a chosen few. Compared as parsed
    // JSON rather than as bytes, because Max writes whole numbers as "34.0" and
    // JSON.stringify writes "34"; a JS number cannot carry the difference.
    const dir = fileURLToPath(new URL('../public/test-patches/', import.meta.url));
    const names = readdirSync(dir).filter((n) => n.endsWith('.maxpat'));
    expect(names.length).toBeGreaterThanOrEqual(14);

    for (const name of names) {
      const original = loadSample(name);
      const rewritten = patchToMaxPat(parseMaxPat(original), { maxpylangCompat: true });
      expect(rewritten, name).toEqual(original);
    }
  });
});

describe('EMPTY_PATCHER_HEADER', () => {
  it('has the keys a .maxpat patcher needs', () => {
    for (const key of [
      'fileversion',
      'appversion',
      'classnamespace',
      'rect',
      'dependency_cache',
      'autosave',
    ]) {
      expect(key in EMPTY_PATCHER_HEADER, key).toBe(true);
    }
    // It is a HEADER — the graph is the writer's to add, so it carries neither.
    expect('boxes' in EMPTY_PATCHER_HEADER).toBe(false);
    expect('lines' in EMPTY_PATCHER_HEADER).toBe(false);
    // ...and an emitted patcher has all eight.
    const out = write({ nodes: [], edges: [], byId: new Map() }).patcher;
    const required = ['fileversion', 'appversion', 'classnamespace', 'rect'];
    for (const key of [...required, 'boxes', 'lines', 'dependency_cache', 'autosave']) {
      expect(key in out, key).toBe(true);
    }
  });

  itWithTemplate('deep-equals maxpylang\'s empty_template.json minus boxes and lines', () => {
    const template = JSON.parse(readFileSync(templatePath, 'utf-8')).patcher as Record<
      string,
      unknown
    >;
    delete template.boxes;
    delete template.lines;
    expect({ ...EMPTY_PATCHER_HEADER }).toEqual(template);
    // Same keys in the same order, so a file written from it diffs cleanly against Max's.
    expect(Object.keys(EMPTY_PATCHER_HEADER)).toEqual(Object.keys(template));
  });

  it('is frozen, so one stray edit cannot corrupt every later save', () => {
    expect(Object.isFrozen(EMPTY_PATCHER_HEADER)).toBe(true);
    expect(Object.isFrozen(EMPTY_PATCHER_HEADER.rect)).toBe(true);
  });
});
