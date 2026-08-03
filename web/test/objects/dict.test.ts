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
  for (let i = 0; i < 4; i++) node.onControlOut?.(i, (m) => out.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const on = (outlet: number) => out.filter((e) => e.outlet === outlet).map((e) => e.m);
  return { node, out, send, on };
}

// Extract the dict name carried by a `dictionary <name>` reference message.
const refName = (m: Msg) => (m[0] === 'dictionary' ? (m[1] as string) : undefined);

describe('dict (named store)', () => {
  it('set / get a scalar and a list value', () => {
    const { on, send } = build('dict', 'd1');
    send(['set', 'freq', 440]);
    send(['set', 'pt', 1, 2, 3]);
    send(['get', 'freq']);
    send(['get', 'pt']);
    expect(on(0)).toEqual([[440], [1, 2, 3]]);
  });

  it('get of a missing key emits an empty message', () => {
    const { on, send } = build('dict', 'd2');
    send(['get', 'nope']);
    expect(on(0)).toEqual([[]]);
  });

  it('append extends a key value list', () => {
    const { on, send } = build('dict', 'd3');
    send(['set', 'k', 1]);
    send(['append', 'k', 2, 3]);
    send(['get', 'k']);
    expect(on(0)).toEqual([[1, 2, 3]]);
  });

  it('replace overwrites, delete removes', () => {
    const { on, send } = build('dict', 'd4');
    send(['set', 'k', 1]);
    send(['replace', 'k', 9]);
    send(['get', 'k']);
    send(['delete', 'k']);
    send(['get', 'k']);
    expect(on(0)).toEqual([[9], []]);
  });

  it('getkeys and getsize report contents', () => {
    const { on, send } = build('dict', 'd5');
    send(['set', 'a', 1]);
    send(['set', 'b', 2]);
    send(['getkeys']);
    send(['getsize']);
    expect(on(0)).toEqual([['a', 'b'], [2]]);
  });

  it('clear empties the store', () => {
    const { on, send } = build('dict', 'd6');
    send(['set', 'a', 1]);
    send(['clear']);
    send(['getsize']);
    expect(on(0)).toEqual([[0]]);
  });

  it('dump emits each entry on outlet 0 then a dumpout bang on outlet 3', () => {
    const { on, send } = build('dict', 'd7');
    send(['set', 'a', 1]);
    send(['set', 'b', 2, 3]);
    send(['dump']);
    expect(on(0)).toEqual([['a', 1], ['b', 2, 3]]);
    expect(on(3)).toEqual([bang]);
  });

  it('bang emits the dictionary reference on outlet 1', () => {
    const { on, send } = build('dict', 'shared');
    send(bang);
    expect(on(1)).toEqual([['dictionary', 'shared']]);
  });

  it('named instances share one underlying store', () => {
    const a = build('dict', 'twin');
    const b = build('dict', 'twin');
    a.send(['set', 'x', 7]);
    b.send(['get', 'x']);
    expect(b.on(0)).toEqual([[7]]);
  });
});

describe('dict.pack / dict.unpack round trip', () => {
  it('pack assembles key/value messages into a reference; unpack recovers them', () => {
    const pack = build('dict.pack');
    pack.send(['freq', 440]);
    pack.send(['amp', 0.5]);
    pack.send(bang);
    const r = pack.on(0)[0];
    expect(refName(r)).toBeDefined();

    const unpack = build('dict.unpack');
    unpack.send(r);
    expect(unpack.on(0)).toEqual([['freq', 440], ['amp', 0.5]]);
  });

  it('unpack with key args restricts and orders the emitted keys', () => {
    const pack = build('dict.pack');
    pack.send(['a', 1]);
    pack.send(['b', 2]);
    pack.send(['c', 3]);
    pack.send(bang);
    const r = pack.on(0)[0];

    const unpack = build('dict.unpack', 'c', 'a');
    unpack.send(r);
    expect(unpack.on(0)).toEqual([['c', 3], ['a', 1]]);
  });
});

describe('dict.iter', () => {
  it('iterates every entry of a dict reference and re-iterates on bang', () => {
    const pack = build('dict.pack');
    pack.send(['a', 1]);
    pack.send(['b', 2]);
    pack.send(bang);
    const r = pack.on(0)[0];

    const iter = build('dict.iter');
    iter.send(r);
    iter.send(bang); // re-iterate the remembered dict
    expect(iter.on(0)).toEqual([['a', 1], ['b', 2], ['a', 1], ['b', 2]]);
  });
});

describe('dict.join', () => {
  it('merges the inlet-1 overlay on top of the inlet-0 base', () => {
    const base = build('dict.pack');
    base.send(['a', 1]);
    base.send(['b', 2]);
    base.send(bang);
    const baseRef = base.on(0)[0];

    const over = build('dict.pack');
    over.send(['b', 20]); // overrides b
    over.send(['c', 3]); // new key
    over.send(bang);
    const overRef = over.on(0)[0];

    const join = build('dict.join');
    join.send(overRef, 1); // store overlay first
    join.send(baseRef, 0); // trigger merge
    const merged = join.on(0)[0];

    const unpack = build('dict.unpack');
    unpack.send(merged);
    expect(unpack.on(0)).toEqual([['a', 1], ['b', 20], ['c', 3]]);
  });
});

describe('dict.strip', () => {
  it('removes the named keys and bangs the dumpout', () => {
    const pack = build('dict.pack');
    pack.send(['keep', 1]);
    pack.send(['drop', 2]);
    pack.send(bang);
    const r = pack.on(0)[0];

    const strip = build('dict.strip', 'drop');
    strip.send(r);
    const stripped = strip.on(0)[0];
    expect(strip.on(1)).toEqual([bang]);

    const unpack = build('dict.unpack');
    unpack.send(stripped);
    expect(unpack.on(0)).toEqual([['keep', 1]]);
  });
});

describe('dict.route', () => {
  it('splits entries by key membership across the two outlets', () => {
    const pack = build('dict.pack');
    pack.send(['x', 1]);
    pack.send(['y', 2]);
    pack.send(['z', 3]);
    pack.send(bang);
    const r = pack.on(0)[0];

    const route = build('dict.route', 'x', 'z');
    route.send(r);

    const matched = build('dict.unpack');
    matched.send(route.on(0)[0]);
    expect(matched.on(0)).toEqual([['x', 1], ['z', 3]]);

    const rest = build('dict.unpack');
    rest.send(route.on(1)[0]);
    expect(rest.on(0)).toEqual([['y', 2]]);
  });
});

describe('dict.serialize / dict.deserialize', () => {
  it('serializes a dict to JSON text and deserializes it back', () => {
    const pack = build('dict.pack');
    pack.send(['freq', 440]);
    pack.send(['pt', 1, 2, 3]);
    pack.send(bang);
    const r = pack.on(0)[0];

    const ser = build('dict.serialize');
    ser.send(r);
    const json = ser.on(0)[0][0] as string;
    expect(JSON.parse(json)).toEqual({ freq: 440, pt: [1, 2, 3] });

    const deser = build('dict.deserialize');
    deser.send([json]);
    const back = deser.on(0)[0];

    const unpack = build('dict.unpack');
    unpack.send(back);
    expect(unpack.on(0)).toEqual([['freq', 440], ['pt', 1, 2, 3]]);
  });

  it('ignores invalid JSON', () => {
    const deser = build('dict.deserialize');
    deser.send(['{not valid']);
    expect(deser.on(0)).toEqual([]);
  });
});
