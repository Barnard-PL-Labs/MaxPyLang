// src/codegen/maxpy.ts — the patch document, written back out as a MaxPy script.
//
// Three properties carry the weight, and all three are about the DIFF the user sees
// rather than about whether the script runs:
//
//   • DETERMINISM. The generator is called on a 150 ms debounce from the document's own
//     change feed (ui/sync.ts), so a document that produced two different strings would
//     rewrite the editor — scrolling it, moving the caret — on every idle tick.
//   • STABLE NAMES. Retyping one box must rewrite one line. A generator that named boxes
//     positionally would renumber every variable after the one that changed, and the
//     "read-only live projection" would be unreadable as a projection of anything.
//   • FAITHFUL place() TEXT. The output has to round-trip through maxpylang, which means
//     inverting text.py:get_text's single asymmetry (a message box's text carries no
//     class name) WITHOUT doubling a class name that is already there (maxpylang writes
//     `"text": "ezdac~"` into every UI box it saves). Getting either half wrong produces
//     a script that instantiates the wrong object, silently.
//
// Headless (Node): codegen is pure string work over plain data. It needs
// generated/boxspecs.json only because the DOCUMENTS it is fed are built through
// PatchDoc.create()/open(), which wait for real arity.
//
// NOT TESTED HERE: the Pyodide worker, and therefore whether maxpylang actually reads
// these scripts back. That needs a ~15 MB network download and a WASM runtime, which is
// exactly what must never happen inside `npx vitest run` — the parity check that does
// run Python is gated behind MAXPY_PARITY=1 for the same reason. The round trip is a
// manual step (plan §Verification, step 7).

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PatchDoc } from '../src/doc/patch-doc';
import { loadBoxSpecs } from '../src/ir/objectspec';
import { parseMaxPat } from '../src/parser/maxpat';
import { forgetNames, patchToMaxPy, placeTextFor, varNameFor } from '../src/codegen/maxpy';
import type { IRNode } from '../src/ir/types';

// Same guard as doc.test.ts: the generated table is committed, but a fresh checkout that
// hasn't run `npm run gen:manifest` should skip rather than fail, and skipIf is evaluated
// at collection time so it has to be a file check.
const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

function loadPatch(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../public/test-patches/${name}`, import.meta.url)), 'utf8'),
  );
}

/** A minimal node, for the placeTextFor cases that have no document behind them. */
function node(partial: Partial<IRNode> & Pick<IRNode, 'className' | 'maxclass' | 'text'>): IRNode {
  return {
    id: 'obj-1',
    args: [],
    numInlets: 1,
    numOutlets: 1,
    outletDomains: [],
    rect: [0, 0, 40, 22],
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots. Written out in full rather than as .toMatchSnapshot(), because the exact
// whitespace IS the contract here — the aligned move() column is what makes a generated
// script read like the hand-written STARTER it is modelled on.
// ─────────────────────────────────────────────────────────────────────────────

describe('patchToMaxPy — snapshots', () => {
  itWithSpecs('an empty patch is still a runnable script', async () => {
    const doc = await PatchDoc.create();
    expect(patchToMaxPy(doc, { banner: false })).toBe(
      [
        'import maxpylang as mp',
        '',
        'patch = mp.MaxPatch()',
        '',
        'patch.save("my_patch.maxpat")',
        '',
      ].join('\n'),
    );
  });

  itWithSpecs('a hand-built patch: aligned moves, then cords, in document order', async () => {
    const doc = await PatchDoc.create();
    const osc = doc.addBox('cycle~ 440', 40, 60);
    const amp = doc.addBox('*~ 0.2', 40, 120);
    const dac = doc.addBox('ezdac~', 40, 180);
    const msg = doc.addBox('message 440', 220, 60);
    const tog = doc.addBox('toggle', 320, 60);
    const osc2 = doc.addBox('cycle~ 660', 120, 60);
    doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });
    doc.addEdge({ id: osc2.id, outlet: 0 }, { id: amp.id, inlet: 0 });
    doc.addEdge({ id: amp.id, outlet: 0 }, { id: dac.id, inlet: 0 });
    doc.addEdge({ id: amp.id, outlet: 0 }, { id: dac.id, inlet: 1 });
    doc.addEdge({ id: msg.id, outlet: 0 }, { id: osc.id, inlet: 0 });
    doc.addEdge({ id: tog.id, outlet: 0 }, { id: dac.id, inlet: 0 });

    expect(patchToMaxPy(doc, { banner: false, filename: 'chain.maxpat' })).toBe(
      [
        'import maxpylang as mp',
        '',
        'patch = mp.MaxPatch()',
        '',
        'cycle = patch.place("cycle~ 440")[0];     cycle.move(40, 60)',
        'times = patch.place("*~ 0.2")[0];         times.move(40, 120)',
        'ezdac = patch.place("ezdac~")[0];         ezdac.move(40, 180)',
        'message = patch.place("message 440")[0];  message.move(220, 60)',
        'toggle = patch.place("toggle")[0];        toggle.move(320, 60)',
        'cycle_2 = patch.place("cycle~ 660")[0];   cycle_2.move(120, 60)',
        '',
        'patch.connect([cycle.outs[0], times.ins[0]])',
        'patch.connect([cycle_2.outs[0], times.ins[0]])',
        'patch.connect([times.outs[0], ezdac.ins[0]])',
        'patch.connect([times.outs[0], ezdac.ins[1]])',
        'patch.connect([message.outs[0], cycle.ins[0]])',
        'patch.connect([toggle.outs[0], ezdac.ins[0]])',
        '',
        'patch.save("chain.maxpat")',
        '',
      ].join('\n'),
    );
  });

  itWithSpecs('a real .maxpat: the UI box keeps ONE class name, not two', async () => {
    // hello_world.maxpat was written by maxpylang, so its ezdac~ box carries
    // `"text": "ezdac~"` — the class name, put there by get_text(). Prefixing it again
    // would generate place("ezdac~ ezdac~"): an unknown object, and a silent one.
    const doc = await PatchDoc.open(parseMaxPat(loadPatch('hello_world.maxpat')));
    expect(patchToMaxPy(doc, { banner: false })).toBe(
      [
        'import maxpylang as mp',
        '',
        'patch = mp.MaxPatch()',
        '',
        'cycle = patch.place("cycle~ 440")[0];  cycle.move(80, 80)',
        'times = patch.place("*~ 0.2")[0];      times.move(160, 80)',
        'ezdac = patch.place("ezdac~")[0];      ezdac.move(240, 80)',
        '',
        'patch.connect([cycle.outs[0], times.ins[0]])',
        'patch.connect([times.outs[0], ezdac.ins[0]])',
        'patch.connect([times.outs[0], ezdac.ins[1]])',
        '',
        'patch.save("my_patch.maxpat")',
        '',
      ].join('\n'),
    );
  });

  itWithSpecs('the banner is on by default and says what cannot be represented', async () => {
    const doc = await PatchDoc.create();
    const out = patchToMaxPy(doc);
    expect(out.startsWith('# Generated from the patcher canvas.')).toBe(true);
    // The honest disclosure: maxpylang has move() but no resize, so box geometry beyond
    // x/y does not survive this transform. Saying so is the contract, not decoration.
    expect(out).toContain('not resize');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('patchToMaxPy — determinism', () => {
  itWithSpecs('the same document produces a byte-identical string twice', async () => {
    const doc = await PatchDoc.open(parseMaxPat(loadPatch('fm_synth.maxpat')));
    expect(patchToMaxPy(doc)).toBe(patchToMaxPy(doc));
  });

  itWithSpecs('two documents built the same way produce the same string', async () => {
    const build = async () => {
      const doc = await PatchDoc.create();
      const a = doc.addBox('cycle~ 440', 10, 10);
      const b = doc.addBox('gain~', 10, 60);
      doc.addEdge({ id: a.id, outlet: 0 }, { id: b.id, inlet: 0 });
      return doc;
    };
    expect(patchToMaxPy(await build())).toBe(patchToMaxPy(await build()));
  });

  itWithSpecs('generating does not touch the document', async () => {
    // The plan asks for a doc.reorder() here; it is deliberately NOT done, because this
    // runs on a debounce from the document's own change feed and reorder() is an undoable
    // edit that would both cost the user a Cmd-Z per idle tick and re-enter that feed.
    const doc = await PatchDoc.create();
    doc.addBox('cycle~ 440', 10, 10);
    const revision = doc.revision;
    const canRedo = doc.canRedo;
    patchToMaxPy(doc);
    expect(doc.revision).toBe(revision);
    expect(doc.canRedo).toBe(canRedo);
    expect([...doc.nodes()].map((n) => n.id)).toEqual(['obj-1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variable names
// ─────────────────────────────────────────────────────────────────────────────

describe('varNameFor', () => {
  it('turns a Max class name into a legal, readable identifier', () => {
    expect(varNameFor('cycle~')).toBe('cycle');
    expect(varNameFor('*~')).toBe('times');
    expect(varNameFor('jit.movie')).toBe('jit_movie');
    expect(varNameFor('mc.*~')).toBe('mc_times');
    expect(varNameFor('windowed-fft~')).toBe('windowed_fft');
    expect(varNameFor('==~')).toBe('eq');
    expect(varNameFor('!-')).toBe('rminus');
  });

  it('prefixes a leading digit — an identifier may not start with one', () => {
    expect(varNameFor('2d.wave~')).toBe('_2d_wave');
  });

  it('escapes the Max classes that are Python keywords or builtins', () => {
    // All seven really are in the manifest: `if = patch.place("if")[0]` does not parse.
    for (const name of ['if', 'in', 'match', 'print', 'int', 'float', 'dict']) {
      expect(varNameFor(name)).toBe(`${name}_`);
    }
  });

  it('never produces the script\'s own locals, and never an empty name', () => {
    expect(varNameFor('patch')).toBe('patch_');
    expect(varNameFor('mp')).toBe('mp_');
    expect(varNameFor('')).toBe('obj');
    expect(varNameFor('~')).toBe('obj');
  });
});

describe('patchToMaxPy — stable names across an edit', () => {
  itWithSpecs('retyping one box rewrites one line, not every line after it', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 1', 0, 0);
    doc.addBox('cycle~ 2', 0, 40);
    doc.addBox('cycle~ 3', 0, 80);

    const before = patchToMaxPy(doc, { banner: false });
    expect(before).toContain('cycle = patch.place("cycle~ 1")[0];');
    expect(before).toContain('cycle_2 = patch.place("cycle~ 2")[0];');
    expect(before).toContain('cycle_3 = patch.place("cycle~ 3")[0];');

    // Change the FIRST box's class. Naming positionally would slide cycle_2 -> cycle and
    // cycle_3 -> cycle_2, so a one-box edit would rewrite every line and every cord.
    doc.setBoxText(a.id, 'saw~ 1');
    const after = patchToMaxPy(doc, { banner: false });
    expect(after).toContain('saw = patch.place("saw~ 1")[0];');
    expect(after).toContain('cycle_2 = patch.place("cycle~ 2")[0];');
    expect(after).toContain('cycle_3 = patch.place("cycle~ 3")[0];');
    expect(after).not.toContain('cycle = ');
  });

  itWithSpecs('moving a box changes only its coordinates', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    doc.addBox('gain~', 0, 40);
    const before = patchToMaxPy(doc, { banner: false });
    doc.moveNodes([a.id], 25, 5);
    const after = patchToMaxPy(doc, { banner: false });
    expect(after).toBe(before.replace('cycle.move(0, 0)', 'cycle.move(25, 5)'));
  });

  itWithSpecs('a deleted box frees its name, and the rest keep theirs', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 1', 0, 0);
    doc.addBox('cycle~ 2', 0, 40);
    patchToMaxPy(doc);
    doc.removeNodes([a.id]);
    // The survivor was `cycle_2` and stays `cycle_2`: renaming it to `cycle` because a
    // slot opened up is exactly the churn the cache exists to prevent.
    expect(patchToMaxPy(doc, { banner: false })).toContain('cycle_2 = patch.place("cycle~ 2")');
  });

  itWithSpecs('forgetNames() re-derives the canonical naming', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 1', 0, 0);
    doc.addBox('cycle~ 2', 0, 40);
    patchToMaxPy(doc);
    doc.removeNodes([a.id]);
    forgetNames(doc);
    expect(patchToMaxPy(doc, { banner: false })).toContain('cycle = patch.place("cycle~ 2")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// place() text — the message inversion and its neighbours
// ─────────────────────────────────────────────────────────────────────────────

describe('placeTextFor', () => {
  it('puts the class name back on a message box — get_text takes it off', () => {
    // text.py:get_text writes `name + args` for every class EXCEPT message, whose text is
    // its contents alone. So a message box reading "440" must be placed as "message 440";
    // place("440") would look for an object called "440" and get an unknown box.
    const msg = node({ className: 'message', maxclass: 'message', text: '440', args: [440] });
    expect(placeTextFor(msg)).toBe('message 440');
  });

  it('does not double a class name maxpylang already wrote into the text', () => {
    // maxpylang saves `"text": "toggle"` in a toggle box; ir/objectspec keeps the line
    // that was typed ("message 440") in a box created on the canvas. Both name the class.
    const tog = node({ className: 'toggle', maxclass: 'toggle', text: 'toggle', args: ['toggle'] });
    expect(placeTextFor(tog)).toBe('toggle');

    const typed = node({ className: 'message', maxclass: 'message', text: 'message 440', args: [440] });
    expect(placeTextFor(typed)).toBe('message 440');
  });

  it('keeps a message whose contents genuinely begin with "message"', () => {
    // Two atoms, "message" and "loud" — not a class name plus one argument. The arg count
    // is what tells them apart, which is why the node's own args are consulted.
    const msg = node({
      className: 'message',
      maxclass: 'message',
      text: 'message loud',
      args: ['message', 'loud'],
    });
    expect(placeTextFor(msg)).toBe('message message loud');
  });

  it('leaves a newobj alone — its text already names its class', () => {
    expect(placeTextFor(node({ className: 'cycle~', maxclass: 'newobj', text: 'cycle~ 440' }))).toBe(
      'cycle~ 440',
    );
  });

  it('names an empty UI box by its class', () => {
    // Real Max writes no `text` key at all for most UI boxes.
    expect(placeTextFor(node({ className: 'slider', maxclass: 'slider', text: '' }))).toBe('slider');
  });

  it('collapses whitespace, because parse_text splits on single spaces', () => {
    // Upstream does `text.strip(" ").split(" ")` and then indexes token[0]; a double space
    // leaves an empty token and raises IndexError inside maxpylang.
    expect(placeTextFor(node({ className: 'cycle~', maxclass: 'newobj', text: 'cycle~   440' }))).toBe(
      'cycle~ 440',
    );
  });
});

describe('patchToMaxPy — string escaping', () => {
  itWithSpecs('quotes and backslashes in box text stay inside the literal', async () => {
    const doc = await PatchDoc.create();
    doc.addBox('message say "hi" \\ok', 0, 0);
    const out = patchToMaxPy(doc, { banner: false });
    expect(out).toContain('patch.place("message say \\"hi\\" \\\\ok")[0];');
  });

  itWithSpecs('the save() filename is escaped too', async () => {
    const doc = await PatchDoc.create();
    expect(patchToMaxPy(doc, { banner: false, filename: 'a"b.maxpat' })).toContain(
      'patch.save("a\\"b.maxpat")',
    );
  });
});

describe('patchToMaxPy — unknown and hostile input', () => {
  itWithSpecs('an unknown object still places, under its own name', async () => {
    const doc = await PatchDoc.create();
    doc.addBox('nosuchobject 1 2', 0, 0);
    expect(patchToMaxPy(doc, { banner: false })).toContain(
      'nosuchobject = patch.place("nosuchobject 1 2")[0];',
    );
  });

  itWithSpecs('a non-finite coordinate becomes 0 rather than `NaN`', async () => {
    const doc = await PatchDoc.create();
    const a = doc.addBox('cycle~ 440', 0, 0);
    // Straight from a corrupt file: patching_rect is whatever the JSON held.
    (doc.node(a.id)!.rect as number[])[0] = Number.NaN;
    expect(patchToMaxPy(doc, { banner: false })).toContain('cycle.move(0, 0)');
  });
});
