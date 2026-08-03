import { describe, expect, it } from 'vitest';
import '../../src/objects/ui/sliders'; // direct import — isolated from the bootstrap
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // UI widgets ignore the audio context

// Build a widget and capture messages on any outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Msg[][] = [];
  const capture = (outlet: number) => {
    outs[outlet] ??= [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, capture, send };
}
const bang: Msg = ['bang'];

describe('ui slider widgets', () => {
  it('all widgets build headless with el === undefined (no DOM)', () => {
    for (const name of ['slider', 'dial', 'kslider', 'rslider', 'nslider', 'incdec']) {
      const { node } = build(name);
      expect(node.el).toBeUndefined();
      expect(node.controlIns?.length).toBeGreaterThan(0);
    }
  });

  it('slider clamps an incoming number into [min, max] and emits it', () => {
    const { outs, capture, send } = build('slider', 128, 1, 0); // range 0..127
    capture(0);
    send([64]);
    send([200]); // above max -> 127
    send([-5]); // below min -> 0
    expect(outs[0].map((m) => m[0])).toEqual([64, 127, 0]);
  });

  it('slider respects the mult arg (value = min + raw*mult, quantized)', () => {
    const { outs, capture, send } = build('slider', 128, 2, 0); // step of 2
    capture(0);
    send([10]); // raw 5 -> 10
    send([11]); // raw round(5.5)=6 -> 12
    send([1000]); // raw clamped to 127 -> 254
    expect(outs[0].map((m) => m[0])).toEqual([10, 12, 254]);
  });

  it('slider respects a non-zero min offset', () => {
    const { outs, capture, send } = build('slider', 128, 1, 10); // range 10..137
    capture(0);
    send([5]); // below min -> 10
    send([50]);
    expect(outs[0].map((m) => m[0])).toEqual([10, 50]);
  });

  it('bang re-outputs the slider value without changing it', () => {
    const { outs, capture, send } = build('slider', 128, 1, 0);
    capture(0);
    send([42]);
    send(bang);
    send(bang);
    expect(outs[0].map((m) => m[0])).toEqual([42, 42, 42]);
  });

  it('dial behaves as a range widget too', () => {
    const { outs, capture, send } = build('dial', 128, 1, 0);
    capture(0);
    send([300]);
    send(bang);
    expect(outs[0].map((m) => m[0])).toEqual([127, 127]);
  });

  it('incdec sets its value from the inlet and re-emits on bang', () => {
    const { outs, capture, send } = build('incdec');
    capture(0);
    send([7]);
    send(bang);
    expect(outs[0].map((m) => m[0])).toEqual([7, 7]);
  });

  it('kslider emits pitch (outlet 0) and velocity (outlet 1) on a note', () => {
    const { outs, capture, send } = build('kslider');
    capture(0);
    capture(1);
    send([60]); // middle C
    send([200], 1); // set velocity (clamped to 127), no emit yet
    send([64]); // note with updated velocity
    expect(outs[0].map((m) => m[0])).toEqual([60, 64]);
    expect(outs[1].map((m) => m[0])).toEqual([100, 127]);
  });

  it('kslider clamps pitch into 0..127 and re-emits on bang', () => {
    const { outs, capture, send } = build('kslider');
    capture(0);
    capture(1);
    send([999]);
    send(bang);
    expect(outs[0].map((m) => m[0])).toEqual([127, 127]);
    expect(outs[1].length).toBe(2);
  });

  it('nslider stores pitch/velocity and emits both outlets', () => {
    const { outs, capture, send } = build('nslider');
    capture(0);
    capture(1);
    send([72]);
    expect(outs[0].map((m) => m[0])).toEqual([72]);
    expect(outs[1].length).toBe(1);
  });

  it('rslider stores a low/high range and emits both bounds', () => {
    const { outs, capture, send } = build('rslider', 128); // 0..127
    capture(0);
    capture(1);
    send([20]); // low
    send([80], 1); // high
    send([200], 1); // clamped to 127
    expect(outs[0].map((m) => m[0])).toEqual([20, 20, 20]);
    expect(outs[1].map((m) => m[0])).toEqual([127, 80, 127]);
  });

  it('rslider keeps low <= high', () => {
    const { outs, capture, send } = build('rslider', 128);
    capture(0);
    capture(1);
    send([90]); // low = 90, high pulled up to at least 90
    expect(outs[0].map((m) => m[0])).toEqual([90]);
    expect(outs[1][0][0]).toBe(127); // high default already >= 90
    send([50], 1); // high below low -> low pulled down to 50
    expect(outs[0][outs[0].length - 1][0]).toBe(50);
    expect(outs[1][outs[1].length - 1][0]).toBe(50);
  });
});
