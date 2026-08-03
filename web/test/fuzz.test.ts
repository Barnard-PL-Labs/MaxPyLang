// Fuzz / robustness — the "never crashes a patch" guarantee, enforced.
// (a) Every object builds with empty AND garbage args without throwing.
// (b) A single mega-patch containing one of every object builds cleanly through
//     the full engine, with zero unknowns.

import { describe, expect, it } from 'vitest';
import '../src/objects';
import { MANIFEST, getFactory } from '../src/engine/registry';
import { Engine } from '../src/engine/engine';
import type { IRNode, IRPatch } from '../src/ir/types';

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;

describe('fuzz: nothing throws', () => {
  it('builds every object with empty and garbage args', () => {
    const ctx = new OfflineCtx(2, 128, 44100);
    const garbage = ['???', Number.NaN, -1, 1e9, 'bang', 0.5];
    const failures: string[] = [];
    for (const name of Object.keys(MANIFEST)) {
      for (const args of [[], garbage]) {
        try {
          getFactory(name)!(args, { ctx });
        } catch (e) {
          failures.push(`${name} [${args}]: ${(e as Error).message}`);
        }
      }
    }
    expect(failures.slice(0, 25), `${failures.length} failures`).toEqual([]);
  });

  it('builds a mega-patch of every object without crashing', () => {
    const nodes: IRNode[] = Object.entries(MANIFEST).map(([className, e], i) => ({
      id: `obj-${i}`,
      className,
      args: [],
      maxclass: e.maxclass,
      numInlets: e.numInlets,
      numOutlets: e.numOutlets,
      outletDomains: e.outletDomains,
      rect: [0, 0, 40, 20],
      text: className,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const patch: IRPatch = { nodes, edges: [], byId };

    const engine = new Engine(new OfflineCtx(2, 128, 44100));
    const report = engine.build(patch);

    expect(report.unknown).toEqual([]);
    expect(report.implemented.length + report.stubbed.length).toBe(nodes.length);
    // sanity: our hand-written objects are counted as implemented
    expect(report.implemented).toContain('cycle~');
    expect(report.implemented).toContain('metro');
  });
});
