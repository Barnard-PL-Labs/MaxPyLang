import { describe, expect, it } from 'vitest';
import '../../src/objects/control/random'; // direct import — isolate from other batches
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context
const bang: Msg = ['bang'];

// Build a control object and capture messages leaving a chosen outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs = new Map<number, Msg[]>();
  const capture = (outlet: number) => {
    const arr: Msg[] = [];
    outs.set(outlet, arr);
    node.onControlOut?.(outlet, (m) => arr.push(m));
    return arr;
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, capture, send };
}

describe('random-domain control objects', () => {
  it('drunk stays in [0, max) and steps by at most step size', () => {
    const { capture, send } = build('drunk', 20, 3);
    const out = capture(0);
    send([0]); // set current value to 0 (also outputs)
    for (let i = 0; i < 200; i++) send(bang);
    const vals = out.map((m) => m[0] as number);
    expect(vals.every((v) => Number.isInteger(v) && v >= 0 && v < 20)).toBe(true);
    // consecutive walk steps never exceed the step size
    for (let i = 2; i < vals.length; i++) {
      expect(Math.abs(vals[i] - vals[i - 1])).toBeLessThanOrEqual(3);
    }
  });

  it('drunk respects inlet 1 (range) and inlet 2 (step)', () => {
    const { capture, send } = build('drunk', 4, 1);
    const out = capture(0);
    send([50], 1); // widen range to 50
    send([0]);     // reset value to 0
    for (let i = 0; i < 300; i++) send(bang);
    const vals = out.map((m) => m[0] as number);
    expect(Math.max(...vals)).toBeGreaterThan(4); // range really widened
    expect(vals.every((v) => v >= 0 && v < 50)).toBe(true);
  });

  it('urn draws every value exactly once, then bangs the right outlet', () => {
    const { capture, send } = build('urn', 5);
    const left = capture(0);
    const right = capture(1);
    for (let i = 0; i < 5; i++) send(bang);
    const drawn = left.map((m) => m[0] as number).sort((a, b) => a - b);
    expect(drawn).toEqual([0, 1, 2, 3, 4]); // no replacement — full permutation
    expect(right.length).toBe(1); // exhausted bang fired when last value drawn

    // further bangs produce nothing on the left, more bangs on the right
    left.length = 0;
    send(bang);
    expect(left.length).toBe(0);
    expect(right.length).toBe(2);
  });

  it('urn refills on a clear message', () => {
    const { capture, send } = build('urn', 3);
    const left = capture(0);
    for (let i = 0; i < 3; i++) send(bang); // exhaust
    left.length = 0;
    send(['clear']);
    for (let i = 0; i < 3; i++) send(bang);
    expect(left.length).toBe(3);
    expect(left.map((m) => m[0]).sort()).toEqual([0, 1, 2]);
  });

  it('decide outputs only 0 or 1 and produces both over many trials', () => {
    const { capture, send } = build('decide');
    const out = capture(0);
    for (let i = 0; i < 200; i++) send(bang);
    const vals = out.map((m) => m[0] as number);
    expect(vals.length).toBe(200);
    expect(vals.every((v) => v === 0 || v === 1)).toBe(true);
    expect(vals.some((v) => v === 0)).toBe(true);
    expect(vals.some((v) => v === 1)).toBe(true);
  });
});
