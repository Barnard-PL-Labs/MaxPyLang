import { afterEach, describe, expect, it } from 'vitest';
import '../../src/objects/control/data'; // self-registers this batch only (no glob bootstrap)
import { getFactory } from '../../src/engine/registry';
import { buses } from '../../src/runtime/buses';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a data object and capture every message it emits, tagged by outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 3; i++) node.onControlOut?.(i, (m) => out.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const on = (outlet: number) => out.filter((e) => e.outlet === outlet).map((e) => e.m);
  return { node, out, send, on };
}
const bang: Msg = ['bang'];

afterEach(() => buses.clear()); // reset shared named storage between tests

describe('named value stores (value / v / pv)', () => {
  it('value stores on input and outputs on bang', () => {
    const { on, send } = build('value', 'foo');
    send([42]);
    send(bang);
    expect(on(0)).toEqual([[42]]);
  });

  it('value does not emit when a number is stored (store-on-input, emit-on-bang)', () => {
    const { out, send } = build('value', 'foo');
    send([7]);
    expect(out).toEqual([]);
  });

  it('value / v share one named cell across instances', () => {
    const a = build('value', 'shared');
    const b = build('v', 'shared');
    a.send([99]);
    b.send(bang);
    expect(b.on(0)).toEqual([[99]]);
  });

  it('value seeds from its initial arg but a peer does not clobber it', () => {
    const a = build('value', 'seed', 5);
    build('value', 'seed', 999); // later peer must not overwrite the existing cell
    a.send(bang);
    expect(a.on(0)).toEqual([[5]]);
  });

  it('pv stores an arbitrary message and recalls it', () => {
    const { on, send } = build('pv', 'p');
    send([1, 2, 3]);
    send(bang);
    expect(on(0)).toEqual([[1, 2, 3]]);
  });
});

describe('funbuff', () => {
  it('stores pairs via a list and recalls y by x', () => {
    const { on, send } = build('funbuff');
    send([10, 100]);
    send([20, 200]);
    send([10]); // recall x=10
    send([20]); // recall x=20
    expect(on(0)).toEqual([[100], [200]]);
  });

  it('emits the delta between successive recalls on outlet 1', () => {
    const { on, send } = build('funbuff');
    send([1, 5]);
    send([2, 8]);
    send([1]); // y=5, delta 5-0
    send([2]); // y=8, delta 8-5
    expect(on(1)).toEqual([[5], [3]]);
  });

  it('bangs outlet 2 when a recall misses', () => {
    const { on, send } = build('funbuff');
    send([7]); // nothing stored at 7
    expect(on(2)).toEqual([bang]);
    expect(on(0)).toEqual([]);
  });

  it('stores via right-inlet y then left-inlet x', () => {
    const { on, send } = build('funbuff');
    send([50], 1); // pending y = 50
    send([3]); // stores (3, 50), no recall
    expect(on(0)).toEqual([]);
    send([3]); // now recall
    expect(on(0)).toEqual([[50]]);
  });
});

describe('bag', () => {
  it('adds numbers and dumps them on bang', () => {
    const { on, send } = build('bag');
    send([1]);
    send([2]);
    send(bang);
    expect(on(0).map((m) => m[0]).sort()).toEqual([1, 2]);
  });

  it('remove mode (right inlet 0) deletes a stored number', () => {
    const { on, send } = build('bag');
    send([1]);
    send([2]);
    send([0], 1); // remove mode
    send([1]); // remove 1
    send(bang);
    expect(on(0)).toEqual([[2]]);
  });

  it('collapses duplicates without a duplicate flag', () => {
    const { on, send } = build('bag');
    send([5]);
    send([5]);
    send(bang);
    expect(on(0)).toEqual([[5]]);
  });

  it('keeps duplicates when a duplicate flag arg is given', () => {
    const { on, send } = build('bag', 'dupes');
    send([5]);
    send([5]);
    send(bang);
    expect(on(0)).toEqual([[5], [5]]);
  });
});

describe('prepend / append', () => {
  it('prepend glues its args to the front of a list', () => {
    const { on, send } = build('prepend', 'set');
    send([1, 2]);
    expect(on(0)).toEqual([['set', 1, 2]]);
  });

  it('prepend on a bang emits the prefix alone', () => {
    const { on, send } = build('prepend', 'set');
    send(bang);
    expect(on(0)).toEqual([['set']]);
  });

  it('append glues its args to the back of a list', () => {
    const { on, send } = build('append', 9, 9);
    send([1, 2]);
    expect(on(0)).toEqual([[1, 2, 9, 9]]);
  });
});
