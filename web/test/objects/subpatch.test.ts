// objects/control/subpatch.ts — `p` / `patcher` run their embedded patch.
//
// Control only here (the Node suite's Web Audio is a mock); the signal relay is covered
// in test/browser/sample-playback.test.ts, which renders real audio.

import { describe, expect, it } from 'vitest';
import '../../src/objects';
import { Engine } from '../../src/engine/engine';
import { getFactory, isSupported } from '../../src/engine/registry';
import type { IRNode } from '../../src/ir/types';
import { decodeMax5Patcher } from '../../src/parser/max5-clipboard';
import { parseMaxPat } from '../../src/parser/maxpat';
import type { Msg } from '../../src/runtime/atoms';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

type Box = Record<string, unknown>;
const box = (id: string, x: number, fields: Box): { box: Box } => ({
  box: { id, patching_rect: [x, 0, 40, 20], numinlets: 1, numoutlets: 1, outlettype: [''], ...fields },
});
const line = (from: string, outlet: number, to: string, inlet: number) => ({
  patchline: { source: [from, outlet], destination: [to, inlet] },
});

/** A `p` IR node around an inner patcher dict, as parseMaxPat would hand the engine. */
function pNode(inner: { boxes: unknown[]; lines: unknown[] }, name = 'p test'): IRNode {
  const raw = { id: 'obj-p', maxclass: 'newobj', text: name, numinlets: 2, numoutlets: 2, patcher: inner };
  return parseMaxPat({ patcher: { boxes: [{ box: { ...raw, patching_rect: [0, 0, 60, 22], outlettype: ['', ''] } }], lines: [] } })
    .nodes[0];
}

function build(node: IRNode) {
  const built = getFactory(node.className)!(node.args, { ctx, node });
  const heard: Msg[][] = [];
  for (let i = 0; i < built.signalOuts.length; i++) {
    heard[i] = [];
    built.onControlOut?.(i, (m) => heard[i].push(m));
  }
  return { built, heard, send: (m: Msg, inlet = 0) => built.controlIns?.[inlet]?.(m) };
}

describe('p / patcher', () => {
  it('is a real object under both names', () => {
    expect(isSupported('p')).toBe(true);
    expect(isSupported('patcher')).toBe(true);
  });

  it('relays messages through the inner patch', () => {
    const { heard, send } = build(
      pNode({
        boxes: [
          box('in', 0, { maxclass: 'inlet', numinlets: 0 }),
          box('add', 0, { maxclass: 'newobj', text: '+ 1', numinlets: 2 }),
          box('out', 0, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
        ],
        lines: [line('in', 0, 'add', 0), line('add', 0, 'out', 0)],
      })
    );
    send([5]);
    expect(heard[0]).toEqual([[6]]);
  });

  it('numbers its ports left to right by position, not by id or order in the file', () => {
    const { heard, send } = build(
      pNode({
        // The RIGHT inlet is listed first and has the lower id; it must still be inlet 1.
        boxes: [
          box('a', 300, { maxclass: 'inlet', numinlets: 0 }),
          box('b', 10, { maxclass: 'inlet', numinlets: 0 }),
          box('x', 250, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
          box('y', 20, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
        ],
        lines: [line('b', 0, 'y', 0), line('a', 0, 'x', 0)],
      })
    );
    send(['left'], 0);
    send(['right'], 1);
    expect(heard[0]).toEqual([['left']]);
    expect(heard[1]).toEqual([['right']]);
  });

  it('runs a subpatcher inside a subpatcher', () => {
    const innermost = {
      boxes: [
        box('i', 0, { maxclass: 'inlet', numinlets: 0 }),
        box('m', 0, { maxclass: 'newobj', text: '* 10', numinlets: 2 }),
        box('o', 0, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
      ],
      lines: [line('i', 0, 'm', 0), line('m', 0, 'o', 0)],
    };
    const { heard, send } = build(
      pNode({
        boxes: [
          box('in', 0, { maxclass: 'inlet', numinlets: 0 }),
          box('inner', 0, { maxclass: 'newobj', text: 'p inner', patcher: innermost }),
          box('out', 0, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
        ],
        lines: [line('in', 0, 'inner', 0), line('inner', 0, 'out', 0)],
      })
    );
    send([4]);
    expect(heard[0]).toEqual([[40]]);
  });

  it('an empty `p` typed on the canvas builds with no ports and does not throw', () => {
    const node = { ...pNode({ boxes: [], lines: [] }), raw: undefined };
    const built = getFactory('p')!([], { ctx, node });
    expect(built.signalIns).toEqual([]);
    expect(built.signalOuts).toEqual([]);
    built.dispose?.();
  });

  it('runs the itVaries subpatcher from a real Max copy', async () => {
    // test/fixtures/max5-clipboard-drums.txt is the drum patch copied out of Max. Its
    // `p itVaries` gates a step number (right inlet) into one of 13 `select`s chosen by
    // the pattern number (left inlet); a step the pattern does not hit comes back out.
    const text = readFileSync(
      fileURLToPath(new URL('../fixtures/max5-clipboard-drums.txt', import.meta.url)),
      'utf8'
    );
    const patch = parseMaxPat({ patcher: JSON.parse((await decodeMax5Patcher(text))!) });
    const node = patch.nodes.find((n) => n.text === 'p itVaries')!;
    const { heard, send } = build(node);
    send([1], 0); // pattern 1 → `gate 13`'s first outlet → `select 3 6 8 11`
    send([3], 1); // step 3: a hit, swallowed
    send([5], 1); // step 5: not a hit, out of the select's reject outlet
    send([2], 0); // pattern 2 → second outlet → `select 2 5 7 10`
    send([5], 1); // now 5 is a hit
    send([4], 1); // and 4 is not
    expect(heard[0]).toEqual([[5], [4]]);
  });

  it('a nested engine never suspends the shared context or stops the page transport', async () => {
    const outer = new Engine(ctx);
    const patch = parseMaxPat({
      patcher: {
        boxes: [{ box: { id: 'p1', maxclass: 'newobj', text: 'p x', numinlets: 0, numoutlets: 0, patching_rect: [0, 0, 40, 20], patcher: { boxes: [], lines: [] } } }],
        lines: [],
      },
    });
    expect(outer.build(patch).implemented).toContain('p');
    await outer.start();
    await outer.stop();
    outer.clear();
  });
});
