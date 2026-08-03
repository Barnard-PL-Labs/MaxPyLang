import { describe, expect, it } from 'vitest';
import '../../src/objects/ui/menus'; // direct import — isolates from other batches
import { getFactory, MANIFEST } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// These tests run headless (no jsdom): `document` is undefined, so every widget's
// `el` must stay undefined while the message behavior still works end-to-end.
const ctx = {} as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const listen = (outlet: number) => {
    outs[outlet] = outs[outlet] ?? [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, listen, send };
}

const NAMES = ['umenu', 'tab', 'radiogroup', 'matrixctrl', 'multislider'];

describe('menus batch (UI widgets)', () => {
  it('registers exactly the manifest-listed objects with correct inlet arity', () => {
    for (const name of NAMES) {
      const entry = MANIFEST[name];
      expect(entry, `${name} in manifest`).toBeDefined();
      const { node } = build(name);
      // control-only widgets: one message inlet, no signal ports
      expect(node.signalOuts.length, `${name} no signal outs`).toBe(0);
      expect(node.controlIns?.length, `${name} inlet count`).toBe(1);
      expect(entry.numInlets).toBe(1);
    }
  });

  it('builds headless with el === undefined (no DOM)', () => {
    expect(typeof document).toBe('undefined');
    for (const name of NAMES) {
      const { node } = build(name);
      expect(node.el, `${name} el`).toBeUndefined();
    }
  });

  // ── umenu / tab : index selector, emits [index] + [item symbol] ─────────────
  for (const name of ['umenu', 'tab']) {
    it(`${name} sets index from a number and emits index + symbol`, () => {
      const { outs, listen, send } = build(name, 'a', 'b', 'c', 'd');
      listen(0);
      listen(1);
      send([2]);
      expect(outs[0]).toEqual([[2]]);
      expect(outs[1]).toEqual([['c']]); // item label at index 2
    });

    it(`${name} clamps the index to the item count (arg-respected)`, () => {
      const { outs, listen, send } = build(name, 'x', 'y', 'z'); // 3 items -> [0,2]
      listen(0);
      send([99]);
      send([-4]);
      expect(outs[0]).toEqual([[2], [0]]);
    });

    it(`${name} re-outputs the current selection on bang`, () => {
      const { outs, listen, send } = build(name, 'a', 'b', 'c');
      send([1]); // set, but not yet listening
      listen(0);
      send(['bang']);
      expect(outs[0]).toEqual([[1]]);
    });
  }

  // ── radiogroup : single-outlet index selector ───────────────────────────────
  it('radiogroup sets, clamps to its button count, and re-outputs on bang', () => {
    const { outs, listen, send } = build('radiogroup', 4); // 4 buttons -> [0,3]
    listen(0);
    send([2]);
    send([10]); // clamped to 3
    send(['bang']); // re-output current (3)
    expect(outs[0]).toEqual([[2], [3], [3]]);
  });

  // ── matrixctrl : grid cells emit [col row value] ─────────────────────────────
  it('matrixctrl sets a cell from [col row value] and echoes it', () => {
    const { outs, listen, send } = build('matrixctrl', 8, 8);
    listen(0);
    send([1, 2, 1]);
    expect(outs[0]).toEqual([[1, 2, 1]]);
  });

  it('matrixctrl clamps col/row to the grid dimensions', () => {
    const { outs, listen, send } = build('matrixctrl', 4, 4); // cols/rows 0..3
    listen(0);
    send([99, 99, 1]);
    expect(outs[0]).toEqual([[3, 3, 1]]);
  });

  it('matrixctrl dumps every set cell on bang', () => {
    const { outs, listen, send } = build('matrixctrl', 8, 8);
    send([0, 0, 1]);
    send([1, 1, 1]);
    listen(0);
    send(['bang']);
    expect(outs[0]).toEqual([
      [0, 0, 1],
      [1, 1, 1],
    ]);
  });

  // ── multislider : a list of values, range-clamped ────────────────────────────
  it('multislider replaces its values from a numeric list and emits them', () => {
    const { outs, listen, send } = build('multislider'); // default range 0..1
    listen(0);
    send([0.25, 0.5, 0.75]);
    expect(outs[0]).toEqual([[0.25, 0.5, 0.75]]);
  });

  it('multislider clamps each value to the [min,max] range args', () => {
    const { outs, listen, send } = build('multislider', 3, 0, 10); // size 3, 0..10
    listen(0);
    send([-5, 20, 5]); // clamp -> [0, 10, 5]
    expect(outs[0]).toEqual([[0, 10, 5]]);
  });

  it('multislider re-outputs the current list on bang', () => {
    const { outs, listen, send } = build('multislider', 1, 0, 100);
    send([42]);
    listen(0);
    send(['bang']);
    expect(outs[0]).toEqual([[42]]);
  });
});
