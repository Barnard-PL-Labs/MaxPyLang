// src/ir/connect.ts — may this cord be drawn?
//
// The thing worth testing here is the SHAPE of the policy, not its table of strings. A
// patcher that refuses too much is worse than one that refuses nothing, so each test
// below is either "this is the narrow set we refuse" or "this ordinary gesture is NOT
// refused and NOT even warned about". The second kind is the one that catches a
// regression that would make the editor miserable to use — most of all `number → cycle~`,
// which the reference documents as a `signal` inlet and which every patch in the corpus
// wires anyway.
//
// Headless (Node): the judgement is pure over the document, generated/objdocs.json and
// (optionally) a built node map, so an OfflineAudioContext against the Web Audio mock is
// all the engine half needs.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects'; // bootstrap: real objects + Tier-A stubs, so `built` is realistic
import { canConnect, inletDomain, loadObjDocs, type Verdict } from '../src/ir/connect';
import { PatchDoc } from '../src/doc/patch-doc';
import { Engine } from '../src/engine/engine';
import { loadBoxSpecs } from '../src/ir/objectspec';
import type { MaxNode } from '../src/engine/registry';

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;

const generated = (name: string) =>
  existsSync(fileURLToPath(new URL(`../src/generated/${name}`, import.meta.url)));
// Same guard as doc.test.ts: the generated tables are committed, but a checkout that has
// not run the generators should skip rather than fail, and skipIf runs at collection time.
const ready = generated('boxspecs.json') && generated('objdocs.json');
const test = it.skipIf(!ready);

beforeAll(async () => {
  if (!ready) return;
  await loadBoxSpecs();
  await loadObjDocs();
});

/** A document of one box per line of text, returned alongside its ids. */
async function docOf(...texts: string[]): Promise<{ doc: PatchDoc; id: (t: string) => string }> {
  const doc = await PatchDoc.create();
  const ids = new Map<string, string>();
  texts.forEach((t, i) => ids.set(t, doc.addBox(t, 20, 20 + i * 40).id));
  return { doc, id: (t) => ids.get(t)! };
}

/** The engine's live node map for a document — the optional fourth argument. */
function build(doc: PatchDoc): Map<string, MaxNode> {
  return new Engine(new OfflineCtx(2, 128, 44100)).build(doc.toIR()).built;
}

/** The complaint a verdict carries, whichever kind it is — for readable assertions. */
function note(v: Verdict): string | undefined {
  return v.ok ? ('warn' in v ? v.warn : undefined) : v.reason;
}

describe('what canConnect refuses', () => {
  test('a cord that is already there', async () => {
    const { doc, id } = await docOf('cycle~ 440', '*~ 0.2');
    const from = { id: id('cycle~ 440'), outlet: 0 };
    const to = { id: id('*~ 0.2'), inlet: 0 };
    expect(canConnect(doc, from, to)).toEqual({ ok: true });

    doc.addEdge(from, to);
    expect(canConnect(doc, from, to)).toEqual({ ok: false, reason: 'already connected' });
    // The SAME pair of boxes on a different port pair is a different cord.
    expect(canConnect(doc, from, { id: to.id, inlet: 1 }).ok).toBe(true);
  });

  test('a box wired to itself', async () => {
    const { doc, id } = await docOf('metro 500');
    const v = canConnect(doc, { id: id('metro 500'), outlet: 0 }, { id: id('metro 500'), inlet: 0 });
    expect(v.ok).toBe(false);
    expect(note(v)).toMatch(/itself/);
  });

  test('a port index that is not there', async () => {
    const { doc, id } = await docOf('unpack 1 2 3', 'print');
    const src = id('unpack 1 2 3'); // 3 outlets
    const dst = id('print'); // 1 inlet
    expect(canConnect(doc, { id: src, outlet: 2 }, { id: dst, inlet: 0 }).ok).toBe(true);
    expect(canConnect(doc, { id: src, outlet: 3 }, { id: dst, inlet: 0 }).ok).toBe(false);
    expect(canConnect(doc, { id: src, outlet: -1 }, { id: dst, inlet: 0 }).ok).toBe(false);
    expect(canConnect(doc, { id: src, outlet: 0 }, { id: dst, inlet: 1 }).ok).toBe(false);
    // Not an integer: a hit test that produced 0.5 must not round into a real port.
    expect(canConnect(doc, { id: src, outlet: 0.5 }, { id: dst, inlet: 0 }).ok).toBe(false);
  });

  test('an endpoint the document does not have', async () => {
    const { doc, id } = await docOf('print');
    expect(canConnect(doc, { id: 'obj-999', outlet: 0 }, { id: id('print'), inlet: 0 }).ok).toBe(false);
    expect(canConnect(doc, { id: id('print'), outlet: 0 }, { id: 'obj-999', inlet: 0 }).ok).toBe(false);
  });

  test('a jit_matrix cord into a message inlet, and a message cord into a matrix inlet', async () => {
    const { doc, id } = await docOf('jit.grab', 'jit.window', 'print', 'toggle');

    // The one pairing that is genuinely a different transport in engine.ts: video frames
    // are pumped on a rAF loop, and there is no code path that carries them anywhere else.
    const intoPrint = canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('print'), inlet: 0 });
    expect(intoPrint.ok).toBe(false);
    expect(note(intoPrint)).toMatch(/jit_matrix/);

    const fromToggle = canConnect(doc, { id: id('toggle'), outlet: 0 }, { id: id('jit.window'), inlet: 0 });
    expect(fromToggle.ok).toBe(false);
    expect(note(fromToggle)).toMatch(/jit_matrix/);

    // …and the pairing that IS the transport goes through untouched.
    expect(canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('jit.window'), inlet: 0 })).toEqual({ ok: true });
  });

  test('a jit object is still wirable in the control domain it also has', async () => {
    // jit.grab's inlet is documented `control` and its outlet 1 is a control outlet, so
    // `metro → jit.grab` and `jit.grab outlet 1 → print` — the way every webcam patch in
    // the corpus is driven — must not be caught by the video rule.
    const { doc, id } = await docOf('metro 33', 'jit.grab', 'print');
    expect(canConnect(doc, { id: id('metro 33'), outlet: 0 }, { id: id('jit.grab'), inlet: 0 })).toEqual({ ok: true });
    expect(canConnect(doc, { id: id('jit.grab'), outlet: 1 }, { id: id('print'), inlet: 0 })).toEqual({ ok: true });
  });
});

describe('what canConnect only complains about', () => {
  test('a signal into an inlet that takes messages', async () => {
    const { doc, id } = await docOf('cycle~ 440', 'print');
    const v = canConnect(doc, { id: id('cycle~ 440'), outlet: 0 }, { id: id('print'), inlet: 0 });
    // Still ok: the cord is drawn (dashed) and saved. Max lets you make it too.
    expect(v.ok).toBe(true);
    expect(note(v)).toMatch(/messages, not audio/);
  });

  test('a message into an inlet that takes only audio — but only when a built node says so', async () => {
    const { doc, id } = await docOf('number', 'ezdac~');
    const from = { id: id('number'), outlet: 0 };
    const to = { id: id('ezdac~'), inlet: 0 };

    // ezdac~ is documented `signal` on both inlets, and the documentation is not enough:
    // that same inlet is the one you send 1 and 0 to in real Max. Without a built node
    // there is nothing to warn on.
    expect(canConnect(doc, from, to)).toEqual({ ok: true });

    // With one, the question is answered exactly: this engine's ezdac~ has no controlIns
    // entry for inlet 0, so the message really will go nowhere.
    const v = canConnect(doc, from, to, build(doc));
    expect(v.ok).toBe(true);
    expect(note(v)).toMatch(/audio, not messages/);
  });

  test('number → cycle~ is not a complaint, with or without the engine', async () => {
    // The regression this whole asymmetry exists for. cycle~'s frequency inlet is
    // documented `signal` (type `signal/float`) and is the single most-wired inlet there
    // is; warning on it would put a dashed cord and a console line in front of every
    // beginner's first patch.
    const { doc, id } = await docOf('number', 'cycle~ 440');
    const from = { id: id('number'), outlet: 0 };
    const to = { id: id('cycle~ 440'), inlet: 0 };
    expect(canConnect(doc, from, to)).toEqual({ ok: true });
    expect(canConnect(doc, from, to, build(doc))).toEqual({ ok: true });
  });

  test('the ordinary signal chain is silent about itself', async () => {
    const { doc, id } = await docOf('cycle~ 440', '*~ 0.2', 'ezdac~');
    const built = build(doc);
    expect(canConnect(doc, { id: id('cycle~ 440'), outlet: 0 }, { id: id('*~ 0.2'), inlet: 0 }, built)).toEqual({ ok: true });
    expect(canConnect(doc, { id: id('*~ 0.2'), outlet: 0 }, { id: id('ezdac~'), inlet: 0 }, built)).toEqual({ ok: true });
    expect(canConnect(doc, { id: id('*~ 0.2'), outlet: 0 }, { id: id('ezdac~'), inlet: 1 }, built)).toEqual({ ok: true });
  });
});

describe('how an inlet domain is resolved', () => {
  test('a built node outranks the documentation', async () => {
    // sig~ is the disagreement in the catalog: its reference page documents inlet 0 as a
    // float inlet, and this engine gives it a real audio target. The built object wins
    // because it is not a description of the object, it IS the object — what it exposes
    // is exactly what a cord can reach.
    expect(inletDomain('sig~', 0)).toBe('control');
    const { doc, id } = await docOf('sig~ 440');
    expect(inletDomain('sig~', 0, build(doc).get(id('sig~ 440'))!)).toBe('signal');
  });

  test('a class with no reference page yields no evidence at all, rather than a guess', async () => {
    // `abs` is one of the 8 manifest names objdocs has nothing for. It still has to
    // RESOLVE to something (the IR's default: a message inlet)…
    expect(inletDomain('abs', 0)).toBe('control');
    // …but "no entry" and "documented as control" are different states, and only the
    // second one is allowed to refuse a cord.
    const { doc, id } = await docOf('jit.grab', 'abs', 'print');
    expect(canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('abs'), inlet: 0 })).toEqual({ ok: true });
    expect(canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('print'), inlet: 0 }).ok).toBe(false);
  });

  test('an index past the end of a short reference entry is a message inlet', () => {
    // objdocs documents only the inlets an object's reference page describes, which for
    // many objects is just the leftmost one; the rest are message inlets in every case
    // in the corpus. Anything else here would refuse cords into the right-hand inlets of
    // half the catalog.
    expect(inletDomain('print', 0)).toBe('control');
    expect(inletDomain('print', 7)).toBe('control');
  });

  test('an alias borrows the object it points at', () => {
    // `t` has no entry of its own; MANIFEST says it is `trigger`.
    expect(inletDomain('t', 0)).toBe(inletDomain('trigger', 0));
    expect(inletDomain('jit.window', 0)).toBe('video');
  });
});

describe('before generated/objdocs.json has arrived', () => {
  test('the judgement narrows rather than guessing, so nothing is wrongly refused', async () => {
    // A fresh module registry, so the lazy table is genuinely unloaded — the cache is
    // module-level and every other test in this file has already filled it.
    vi.resetModules();
    const fresh = await import('../src/ir/connect');
    expect(fresh.objDocs()).toBeUndefined();

    const { doc, id } = await docOf('jit.grab', 'print');
    // With no evidence about `print`'s inlet, the video cord is permitted. Being
    // permissive is the safe direction: the cord carries nothing and the user can see
    // that, whereas a refusal with the table merely slow to load would look like a bug
    // in the editor.
    expect(fresh.canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('print'), inlet: 0 })).toEqual({ ok: true });
    // Refusals that need no table are unaffected.
    expect(fresh.canConnect(doc, { id: id('print'), outlet: 0 }, { id: id('print'), inlet: 0 }).ok).toBe(false);

    await fresh.loadObjDocs();
    expect(fresh.canConnect(doc, { id: id('jit.grab'), outlet: 0 }, { id: id('print'), inlet: 0 }).ok).toBe(false);
  });
});
