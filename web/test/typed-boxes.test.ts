// Typing `p`, `patcher`, `live.gain~` and `playlist~` into a fresh box.
//
// These objects all had working factories for patches that arrived by file or paste,
// but a box TYPED on the canvas goes through ir/objectspec's resolveBox instead, which
// only knows what the generated manifest knows. live.gain~ and Max's `p` shorthand are
// not in maxpylang's OBJ_INFO, so the generator carries them as a web-only supplement
// (scripts/gen-manifest.mjs); a subpatcher's ports come from its embedded patch
// (ir/subpatcher.ts). This file pins the whole path: resolve -> document -> engine,
// the loaded-box port rule, the palette, and what the Python generator writes.

import { beforeAll, describe, expect, it } from 'vitest';
import '../src/objects'; // bootstrap real factories BEFORE any catalog call (tiers)
import { objectInfo, matchObjects } from '../src/engine/catalog';
import { getFactory } from '../src/engine/registry';
import { PatchDoc } from '../src/doc/patch-doc';
import { boxSpecs, loadBoxSpecs, resolveBox } from '../src/ir/objectspec';
import { reconcileSubpatcherPorts, subpatcherPorts } from '../src/ir/subpatcher';
import type { IRNode } from '../src/ir/types';
import { parseMaxPat } from '../src/parser/maxpat';
import { patchToMaxPy } from '../src/codegen/maxpy';
import type { Msg } from '../src/runtime/atoms';

const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

beforeAll(async () => {
  await loadBoxSpecs();
});

type Box = Record<string, unknown>;
const box = (id: string, x: number, fields: Box): { box: Box } => ({
  box: { id, patching_rect: [x, 0, 40, 20], numinlets: 1, numoutlets: 1, outlettype: [''], ...fields },
});
const line = (from: string, outlet: number, to: string, inlet: number) => ({
  patchline: { source: [from, outlet], destination: [to, inlet] },
});

/** inlet -> `+ 1` -> outlet, plus a signal outlet fed by cycle~: one in, two out. */
const addOnePatch = () => ({
  boxes: [
    box('in', 10, { maxclass: 'inlet', numinlets: 0 }),
    box('add', 10, { maxclass: 'newobj', text: '+ 1', numinlets: 2 }),
    box('out', 10, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
    box('osc', 200, { maxclass: 'newobj', text: 'cycle~ 440', numinlets: 2, outlettype: ['signal'] }),
    box('sig', 200, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
  ],
  lines: [line('in', 0, 'add', 0), line('add', 0, 'out', 0), line('osc', 0, 'sig', 0)],
});

describe('resolveBox — typed subpatchers', () => {
  it('`p foo` is a known patcher with an empty embedded patch and no ports', () => {
    const spec = resolveBox('p foo');
    expect(spec.known).toBe(true);
    expect(spec.canonical).toBe('patcher');
    expect(spec.maxclass).toBe('newobj');
    expect([spec.numInlets, spec.numOutlets]).toEqual([0, 0]);
    expect(spec.outletTypes).toEqual([]);
    expect(spec.warnings).toEqual([]);
    expect(spec.args).toEqual(['foo']);
    const patcher = spec.box.patcher as { boxes: unknown[]; lines: unknown[] };
    expect(patcher.boxes).toEqual([]);
    expect(patcher.lines).toEqual([]);
  });

  it('`patcher` and `patcher foo` resolve the same way', () => {
    for (const text of ['patcher', 'patcher foo', 'p']) {
      const spec = resolveBox(text);
      expect(spec.known, text).toBe(true);
      expect(spec.canonical, text).toBe('patcher');
      expect([spec.numInlets, spec.numOutlets], text).toEqual([0, 0]);
    }
  });

  it('every box gets its OWN embedded patch — editing one never edits the next', () => {
    const a = resolveBox('p a');
    const b = resolveBox('p b');
    expect(a.box.patcher).not.toBe(b.box.patcher);
    (a.box.patcher as { boxes: unknown[] }).boxes.push({ box: { id: 'x' } });
    expect((b.box.patcher as { boxes: unknown[] }).boxes).toEqual([]);
    expect((boxSpecs()!.patcher.box.patcher as { boxes: unknown[] }).boxes).toEqual([]);
  });
});

describe('resolveBox — typed live.gain~', () => {
  it("is a known box with Max's ports and outlet types", () => {
    const spec = resolveBox('live.gain~', [30, 40]);
    expect(spec.known).toBe(true);
    expect(spec.maxclass).toBe('live.gain~');
    expect([spec.numInlets, spec.numOutlets]).toEqual([2, 5]);
    expect(spec.outletTypes).toEqual(['signal', 'signal', '', 'float', 'list']);
    expect(spec.outletDomains).toEqual(['signal', 'signal', 'control', 'control', 'control']);
    // Max's default is the vertical fader, 48 wide and 136 tall.
    expect(spec.rect).toEqual([30, 40, 48, 136]);
  });

  it("carries Max's default parameter block, which the runtime reads", () => {
    const { box } = resolveBox('live.gain~');
    expect(box.orientation).toBe(0);
    const valueof = (box.saved_attribute_attributes as { valueof: Box }).valueof;
    expect(valueof.parameter_mmin).toBe(-70);
    expect(valueof.parameter_mmax).toBe(6);
    expect(valueof.parameter_initial).toEqual([0]);
    expect(valueof.parameter_initial_enable).toBe(0);
  });

  it('builds as a document box at 0 dB', async () => {
    const doc = await PatchDoc.create();
    const node = doc.addBox('live.gain~', 0, 0);
    const built = getFactory(node.className)!(node.args, { ctx, node });
    const heard: Msg[] = [];
    built.onControlOut?.(2, (m) => heard.push(m));
    built.controlIns?.[0]?.(['bang']);
    expect(heard).toEqual([[0]]);
    expect(built.signalIns.filter(Boolean)).toHaveLength(2);
    built.dispose?.();
  });

  it('playlist~ typed fresh keeps its stereo default: 5 outlets, no clips', () => {
    const spec = resolveBox('playlist~');
    expect(spec.known).toBe(true);
    expect(spec.outletTypes).toEqual(['signal', 'signal', 'signal', '', 'dictionary']);
    expect((spec.box.data as { clips: unknown[] }).clips).toEqual([]);
  });
});

describe('a typed `p` builds and runs', () => {
  it('an empty one builds with no ports; filled, its ports follow the contents', async () => {
    const doc = await PatchDoc.create();
    const node = doc.addBox('p test', 0, 0);
    expect(node.known).toBe(true);
    const empty = getFactory('p')!(node.args, { ctx, node });
    expect(empty.signalIns).toEqual([]);
    empty.dispose?.();

    // What editing the subpatcher amounts to: objects added to the embedded patch.
    node.raw!.patcher = { ...(node.raw!.patcher as Box), ...addOnePatch() };
    reconcileSubpatcherPorts(node);
    expect([node.numInlets, node.numOutlets]).toEqual([1, 2]);
    expect(node.outletDomains).toEqual(['control', 'signal']);

    const built = getFactory('p')!(node.args, { ctx, node });
    const heard: Msg[] = [];
    built.onControlOut?.(0, (m) => heard.push(m));
    built.controlIns?.[0]?.([5]);
    expect(heard).toEqual([[6]]);
    built.dispose?.();
  });
});

describe('subpatcher ports on load', () => {
  const load = (saved: Box) =>
    parseMaxPat({
      patcher: {
        boxes: [{ box: { id: 'sub', maxclass: 'newobj', text: 'p x', patching_rect: [0, 0, 40, 22], ...saved } }],
        lines: [],
      },
    }).nodes[0];

  it('counts inlets/outlets left to right and types an outlet fed by audio "signal"', () => {
    expect(subpatcherPorts(addOnePatch())).toEqual({ numInlets: 1, numOutlets: 2, outletTypes: ['', 'signal'] });
    expect(subpatcherPorts(undefined)).toBeUndefined();
    expect(subpatcherPorts({})).toBeUndefined();
  });

  it('takes the contents when the saved counts are too few (or missing)', () => {
    const node = load({ numinlets: 0, numoutlets: 0, outlettype: [], patcher: addOnePatch() });
    expect([node.numInlets, node.numOutlets]).toEqual([1, 2]);
    expect(node.outletDomains).toEqual(['control', 'signal']);
    const bare = load({ patcher: addOnePatch() });
    expect([bare.numInlets, bare.numOutlets]).toEqual([1, 2]);
  });

  it("keeps the saved counts when they agree or exceed the contents, and the saved types", () => {
    const node = load({ numinlets: 3, numoutlets: 2, outlettype: ['int', ''], patcher: addOnePatch() });
    expect([node.numInlets, node.numOutlets]).toEqual([3, 2]);
    expect(node.outletTypes).toEqual(['int', '']);
  });

  it('leaves a box with no embedded patch (a declared abstraction) as saved', () => {
    const node = load({ numinlets: 1, numoutlets: 1, outlettype: [''] });
    expect([node.numInlets, node.numOutlets]).toEqual([1, 1]);
  });
});

describe('the palette lists them as playable', () => {
  it('live.gain~ is a Tier-B audio object', () => {
    const info = objectInfo('live.gain~')!;
    expect(info).toMatchObject({ tier: 'B', pkg: 'msp', domain: 'signal', numInlets: 2, numOutlets: 5 });
    expect(matchObjects('live.g', { tier: 'B' }).map((o) => o.name)).toContain('live.gain~');
  });

  it('`p` is an alias row of patcher, and both are playable', () => {
    expect(objectInfo('p')).toMatchObject({ tier: 'B', aliasOf: 'patcher' });
    expect(objectInfo('patcher')!.aliases).toContain('p');
    expect(objectInfo('patcher')!.tier).toBe('B');
    expect(matchObjects('p', { limit: 3 }).map((o) => o.name)[0]).toBe('p');
  });
});

describe('patchToMaxPy — objects maxpylang cannot build from text', () => {
  it('declares live.gain~ and a `p` with the ports the canvas shows, and still wires them', async () => {
    const doc = await PatchDoc.create();
    const osc = doc.addBox('cycle~ 440', 0, 0);
    const gain = doc.addBox('live.gain~', 0, 40);
    doc.addBox('p fx', 0, 200);
    const dac = doc.addBox('ezdac~', 0, 260);
    doc.addEdge({ id: osc.id, outlet: 0 }, { id: gain.id, inlet: 0 });
    doc.addEdge({ id: gain.id, outlet: 0 }, { id: dac.id, inlet: 0 });

    const py = patchToMaxPy(doc, { banner: false });
    expect(py).toContain('live_gain = patch.place(mp.MaxObject("live.gain~", abstraction=True, inlets=2, outlets=5))[0];');
    expect(py).toContain('p = patch.place(mp.MaxObject("p fx", abstraction=True, inlets=0, outlets=0))[0];');
    expect(py).toContain('cycle = patch.place("cycle~ 440")[0];');
    expect(py).toContain('patch.connect([cycle.outs[0], live_gain.ins[0]])');
    expect(py).toContain('patch.connect([live_gain.outs[0], ezdac.ins[0]])');
  });

  it('places a portless `patcher` by name — maxpylang knows that one — but declares it once it has ports', () => {
    const plain: IRNode = {
      id: 'obj-1', className: 'patcher', args: [], maxclass: 'newobj', numInlets: 0, numOutlets: 0,
      outletDomains: [], rect: [0, 0, 50, 22], text: 'patcher',
    };
    const src = (n: IRNode) => ({ nodes: () => [n], edges: () => [] });
    expect(patchToMaxPy(src(plain), { banner: false })).toContain('patch.place("patcher")[0]');
    const withPorts = { ...plain, id: 'obj-2', numInlets: 1, numOutlets: 2 };
    expect(patchToMaxPy(src(withPorts), { banner: false })).toContain(
      'patch.place(mp.MaxObject("patcher", abstraction=True, inlets=1, outlets=2))[0]',
    );
  });
});
