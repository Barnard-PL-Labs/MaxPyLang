import { describe, expect, it } from 'vitest';
import '../../src/objects/control/coll'; // self-registers this batch only (no glob bootstrap)
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a control object and capture every message it emits, tagged by outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 4; i++) node.onControlOut?.(i, (m) => out.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const on = (outlet: number) => out.filter((e) => e.outlet === outlet).map((e) => e.m);
  return { node, out, send, on };
}
const bang: Msg = ['bang'];

describe('coll', () => {
  it('stores by leading address and recalls the stored message', () => {
    const c = build('coll');
    c.send([1, 20, 30]); // store [20,30] at address 1
    c.send([2, 99]);     // store [99] at address 2
    c.send([1]);         // recall address 1
    c.send([2]);         // recall address 2
    expect(c.on(0)).toEqual([[20, 30], [99]]);
  });

  it('recalls symbol addresses and stores via the `store` command', () => {
    const c = build('coll');
    c.send(['foo', 1, 2]);       // symbol-address store
    c.send(['store', 3, 7, 8]);  // explicit store command
    c.send(['foo']);             // symbol recall
    c.send([3]);                 // numeric recall
    expect(c.on(0)).toEqual([[1, 2], [7, 8]]);
  });

  it('recalling a missing address emits nothing', () => {
    const c = build('coll');
    c.send([5]);
    expect(c.on(0)).toEqual([]);
  });

  it('bang dumps every entry (address out outlet 1, data out outlet 0) then bangs outlet 3', () => {
    const c = build('coll');
    c.send([1, 10]);
    c.send([2, 20]);
    c.send(bang);
    expect(c.on(1)).toEqual([[1], [2]]);
    expect(c.on(0)).toEqual([[10], [20]]);
    expect(c.on(3)).toEqual([bang]);
  });

  it('clear empties the store', () => {
    const c = build('coll');
    c.send([1, 10]);
    c.send(['clear']);
    c.send([1]);      // nothing to recall
    c.send(bang);     // nothing to dump, just the done-bang
    expect(c.on(0)).toEqual([]);
    expect(c.on(3)).toEqual([bang]);
  });

  it('remove deletes a single entry', () => {
    const c = build('coll');
    c.send([1, 10]);
    c.send([2, 20]);
    c.send(['remove', 1]);
    c.send([1]); // gone
    c.send([2]); // still there
    expect(c.on(0)).toEqual([[20]]);
  });

  it('next walks entries in insertion order and wraps', () => {
    const c = build('coll');
    c.send([1, 10]);
    c.send([2, 20]);
    c.send([3, 30]);
    c.send(['next']);
    c.send(['next']);
    c.send(['next']);
    c.send(['next']); // wraps back to the first
    expect(c.on(0)).toEqual([[10], [20], [30], [10]]);
    expect(c.on(1)).toEqual([[1], [2], [3], [1]]);
  });

  it('prev walks backwards', () => {
    const c = build('coll');
    c.send([0, 100]);
    c.send([1, 200]);
    c.send(['prev']); // ptr starts at 0, prev outputs index 0 then steps back
    c.send(['prev']);
    expect(c.on(0)).toEqual([[100], [200]]);
  });
});

describe('table', () => {
  it('pokes with a list and peeks with a lone int', () => {
    const t = build('table', 128);
    t.send([5, 42]);   // write 42 at index 5
    t.send([5]);       // read index 5
    t.send([9]);       // unwritten -> 0
    expect(t.on(0)).toEqual([[42], [0]]);
  });

  it('truncates stored values to ints and honours `set`', () => {
    const t = build('table', 16);
    t.send([0, 3.9]);          // trunc -> 3
    t.send(['set', 1, 10, 20]); // write 10 at 1, 20 at 2
    t.send([0]);
    t.send([1]);
    t.send([2]);
    expect(t.on(0)).toEqual([[3], [10], [20]]);
  });

  it('ignores out-of-range addresses and clears', () => {
    const t = build('table', 4);
    t.send([10, 5]); // out of range write ignored
    t.send([1, 7]);
    t.send(['clear']);
    t.send([1]);     // zeroed
    t.send([10]);    // out of range read -> nothing
    expect(t.on(0)).toEqual([[0]]);
  });
});
