import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/delay'; // register the "delay" batch only
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// Headless Web Audio mock is installed by test setup (see test/setup/webaudio-mock.ts).
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, send };
}

describe('delay batch', () => {
  it('delay~ builds with a signal outlet and an audio + delay-time inlet', () => {
    const { node } = build('delay~', 44100, 4410);
    expect(node.signalOuts[0]).toBeDefined();      // outlet 0 is signal
    expect(node.signalIns[0]).toBeDefined();       // inlet 0 = audio in
    expect(node.signalIns[1]).toBeDefined();       // inlet 1 = delay time param
  });

  it('delay~ initial-delay arg (samples) lands on delayTime in seconds', () => {
    const { node } = build('delay~', 44100, 4410); // 4410 samples / 44100 = 0.1 s
    expect((node.signalIns[1] as AudioParam).value).toBeCloseTo(0.1, 6);
  });

  it('delay~ float to inlet 1 updates the delay time (samples -> seconds)', () => {
    const { node, send } = build('delay~', 44100, 0);
    send([22050], 1); // 22050 / 44100 = 0.5 s
    expect((node.signalIns[1] as AudioParam).value).toBeCloseTo(0.5, 6);
  });

  it('tapin~ has a signal inlet and a NON-signal (control) outlet', () => {
    const { node } = build('tapin~', 1000);
    expect(node.signalIns[0]).toBeDefined();       // audio in
    expect(node.signalOuts[0]).toBeUndefined();    // outlet 0 is a control tap link
    expect(typeof node.onControlOut).toBe('function');
  });

  it('tapout~ reads the shared line; initial-delay arg (ms) lands on delayTime (s)', () => {
    build('tapin~', 1000);              // establishes the shared delay line
    const { node } = build('tapout~', 250); // 250 ms -> 0.25 s
    expect(node.signalOuts[0]).toBeDefined();      // outlet 0 is signal
    expect((node.signalIns[0] as AudioParam).value).toBeCloseTo(0.25, 6);
  });

  it('tapout~ float to inlet 0 sets the tap time (ms -> seconds)', () => {
    build('tapin~', 1000);
    const { node, send } = build('tapout~', 0);
    send([100]); // 100 ms -> 0.1 s
    expect((node.signalIns[0] as AudioParam).value).toBeCloseTo(0.1, 6);
  });

  it('comb~ builds with 5 inlets, a signal outlet, and coefficient params on args', () => {
    // args: max-delay(ms) init-delay(ms) gain(a) feedforward(b) feedback(c)
    const { node } = build('comb~', 100, 50, 0.5, 0.6, 0.7);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalIns[0]).toBeDefined();                       // audio in
    expect((node.signalIns[1] as AudioParam).value).toBeCloseTo(0.05, 6); // 50 ms -> 0.05 s
    expect((node.signalIns[2] as AudioParam).value).toBeCloseTo(0.5, 6);  // a
    expect((node.signalIns[3] as AudioParam).value).toBeCloseTo(0.6, 6);  // b
    expect((node.signalIns[4] as AudioParam).value).toBeCloseTo(0.7, 6);  // c
  });

  it('comb~ floats update delay time and feedback coefficient', () => {
    const { node, send } = build('comb~', 100, 0, 0, 0, 0);
    send([25], 1); // 25 ms -> 0.025 s delay
    send([0.9], 4); // feedback coefficient
    expect((node.signalIns[1] as AudioParam).value).toBeCloseTo(0.025, 6);
    expect((node.signalIns[4] as AudioParam).value).toBeCloseTo(0.9, 6);
  });
});
