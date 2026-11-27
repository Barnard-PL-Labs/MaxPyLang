// Round trips through the dict family. The per-object behaviour, outlet by outlet as
// Max's reference pages give it, is pinned in dict-max.test.ts.
import { describe, expect, it } from 'vitest';
import '../../src/objects/control/dict'; // self-registers this batch only (no glob bootstrap)
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context
const bang: Msg = ['bang'];

// Build a dict object; capture every message it emits, tagged by outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 6; i++) node.onControlOut?.(i, (m) => out.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const on = (outlet: number) => out.filter((e) => e.outlet === outlet).map((e) => e.m);
  return { node, out, send, on };
}

describe('dict round trips', () => {
  it('dict.pack → dict.unpack recovers each value at its own outlet', () => {
    const pack = build('dict.pack', 'freq:', 'amp:');
    pack.send([0.5], 1);
    pack.send([440], 0);
    const unpack = build('dict.unpack', 'freq:', 'amp:');
    unpack.send(pack.on(0)[0]);
    expect(unpack.on(0)).toEqual([[440]]);
    expect(unpack.on(1)).toEqual([[0.5]]);
  });

  it('dict.pack → dict → get', () => {
    const pack = build('dict.pack', 'note:', 60);
    const store = build('dict', 'rt_store');
    pack.send(bang);
    store.send(pack.on(0)[0]); // cloned into rt_store and passed on
    store.send(['get', 'note']);
    expect(store.on(0)).toEqual([['dictionary', 'rt_store']]);
    expect(store.on(1)).toEqual([['note', 60]]);
  });

  it('dict.serialize → dict.deserialize → dict.iter', () => {
    const pack = build('dict.pack', 'freq:', 440, 'pt:', 1, 2, 3);
    pack.send(bang);
    const ser = build('dict.serialize');
    ser.send(pack.on(0)[0]);
    const deser = build('dict.deserialize');
    deser.send(ser.on(0)[0]);
    const iter = build('dict.iter');
    iter.send(deser.on(0)[0]);
    expect(iter.on(0)).toEqual([['freq', 440], ['pt', 1, 2, 3]]);
  });
});
