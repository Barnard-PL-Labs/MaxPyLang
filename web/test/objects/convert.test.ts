import { describe, expect, it } from 'vitest';
import '../../src/objects/control/convert'; // register the "convert" batch only
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a convert object and capture messages leaving outlet 0.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: Msg[] = [];
  node.onControlOut?.(0, (m) => out.push(m));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, out, send };
}
const bang: Msg = ['bang'];

describe('convert batch', () => {
  it('ftom is the inverse of mtof (440 Hz -> 69)', () => {
    const { out, send } = build('ftom');
    send([440]);
    send([880]);
    expect(out[0][0]).toBe(69);
    expect(out[1][0]).toBe(81);
  });

  it('atodb / dbtoa round-trip through 0 dB = amplitude 1', () => {
    const a = build('atodb');
    a.send([1]);
    expect(a.out[0][0]).toBeCloseTo(0, 6);
    a.send([0.5]);
    expect(a.out[1][0] as number).toBeCloseTo(-6.0206, 3);

    const d = build('dbtoa');
    d.send([0]);
    expect(d.out[0][0]).toBeCloseTo(1, 6);
    d.send([-6.0206]);
    expect(d.out[1][0] as number).toBeCloseTo(0.5, 3);
  });

  it('itoa turns char codes into a symbol; atoi is the inverse', () => {
    const i = build('itoa');
    i.send([72, 73]);
    expect(i.out[0]).toEqual(['HI']);

    const a = build('atoi');
    a.send(['HI']);
    expect(a.out[0]).toEqual([72, 73]);
  });

  it('tosymbol collapses a list to one symbol; fromsymbol parses it back', () => {
    const t = build('tosymbol');
    t.send([1, 2, 3]);
    expect(t.out[0]).toEqual(['1 2 3']);

    const f = build('fromsymbol');
    f.send(['1 2 foo']);
    expect(f.out[0]).toEqual([1, 2, 'foo']);
  });

  it('zmap remaps and clamps to the input range', () => {
    const { out, send } = build('zmap', 0, 127, 0, 1);
    send([127]);
    expect(out[0][0]).toBeCloseTo(1, 6);
    send([200]); // above input max -> clamps to outHi
    expect(out[1][0]).toBeCloseTo(1, 6);
    send([-50]); // below input min -> clamps to outLo
    expect(out[2][0]).toBeCloseTo(0, 6);
  });

  it('zmap updates ranges from inlets 1..4 and re-fires on bang', () => {
    const { out, send } = build('zmap', 0, 127, 0, 1);
    send([64]);
    expect(out[0][0]).toBeCloseTo(64 / 127, 6);
    send([0], 3); // outLo
    send([10], 4); // outHi
    send(bang); // re-map last input (64) with the new output range
    expect(out[1][0]).toBeCloseTo((64 / 127) * 10, 6);
  });
});
