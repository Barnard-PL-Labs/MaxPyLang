// Two readers of one rule must agree: a subpatcher box's ports, left to right from its
// inner inlet/outlet objects, with an outlet typed "signal" when audio reaches it.
//
// ir/subpatcher.ts reads raw box dicts (the parser uses it on load, before any IR
// exists); doc/subpatcher.ts reads the parsed inner patch (the document and the running
// subpatch use it on every edit). If they ever disagreed, a box would load with one set
// of ports and have them silently renumbered by the first edit inside it.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { portLayout, innerPatch, isSubpatcher } from '../src/doc/subpatcher';
import { subpatcherPorts } from '../src/ir/subpatcher';
import { decodeMax5Patcher } from '../src/parser/max5-clipboard';
import { parseMaxPat } from '../src/parser/maxpat';
import type { IRNode } from '../src/ir/types';

/** Every subpatcher box in a patch, at any depth. */
function subpatchers(json: unknown): IRNode[] {
  const out: IRNode[] = [];
  const walk = (patcher: unknown) => {
    for (const node of parseMaxPat({ patcher }).nodes) {
      if (!isSubpatcher(node)) continue;
      out.push(node);
      walk(node.raw?.patcher);
    }
  };
  walk((json as { patcher: unknown }).patcher);
  return out;
}

async function corpus(): Promise<[string, IRNode][]> {
  const found: [string, IRNode][] = [];
  const drums = readFileSync(fileURLToPath(new URL('./fixtures/max5-clipboard-drums.txt', import.meta.url)), 'utf8');
  for (const n of subpatchers({ patcher: JSON.parse((await decodeMax5Patcher(drums))!) })) found.push(['drums', n]);
  const dir = fileURLToPath(new URL('../public/test-patches/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.maxpat'))) {
    for (const n of subpatchers(JSON.parse(readFileSync(dir + f, 'utf8')))) found.push([f, n]);
  }
  return found;
}

describe('subpatcher port rule: raw reader vs IR reader', () => {
  it('agree on every subpatcher in the fixtures, at every depth', async () => {
    const all = await corpus();
    expect(all.length).toBeGreaterThan(0);
    for (const [where, node] of all) {
      const raw = subpatcherPorts(node.raw?.patcher)!;
      const ir = portLayout(innerPatch(node));
      const label = `${where}: ${node.text}`;
      expect(raw.numInlets, label).toBe(ir.inlets.length);
      expect(raw.numOutlets, label).toBe(ir.outlets.length);
      expect(raw.outletTypes.map((t) => (t === 'signal' ? 'signal' : 'control')), label).toEqual(ir.outletDomains);
    }
  });

  it('agree on a hand-made case where file order, position and index all disagree', () => {
    const box = (id: string, x: number, fields: Record<string, unknown>) => ({
      box: { id, patching_rect: [x, 0, 30, 20], numinlets: 1, numoutlets: 1, ...fields },
    });
    const patcher = {
      boxes: [
        box('o2', 300, { maxclass: 'outlet', numoutlets: 0 }),
        box('i2', 200, { maxclass: 'inlet', numinlets: 0, index: 1, outlettype: [''] }),
        box('osc', 0, { maxclass: 'newobj', text: 'cycle~ 440', outlettype: ['signal'] }),
        box('o1', 50, { maxclass: 'outlet', numoutlets: 0 }),
        box('i1', 200, { maxclass: 'inlet', numinlets: 0, index: 0, outlettype: [''] }),
      ],
      lines: [{ patchline: { source: ['osc', 0], destination: ['o2', 0] } }],
    };
    const node = { raw: { patcher }, maxclass: 'newobj', className: 'p' } as unknown as IRNode;
    const raw = subpatcherPorts(patcher)!;
    const ir = portLayout(innerPatch(node));
    expect(ir.outlets).toEqual(['o1', 'o2']);
    expect(raw.outletTypes).toEqual(['', 'signal']);
    expect(ir.outletDomains).toEqual(['control', 'signal']);
    expect(raw.numInlets).toBe(ir.inlets.length);
  });
});
