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

  it('tapin~ announces its line to each cord as the cord is made', () => {
    const { node } = build('tapin~', 1000);
    const heard: Msg[] = [];
    node.onControlOut!(0, (m) => heard.push(m));
    expect(heard.length).toBe(1);
    expect(heard[0][0]).toBe('tapconnect');
  });

  it('tapout~ has one inlet and one outlet per tap time', () => {
    const { node } = build('tapout~', 100, 250, 400);
    expect(node.signalOuts.length).toBe(3);
    expect(node.signalIns.length).toBe(3);
    expect(node.signalOuts.every(Boolean)).toBe(true);
  });

  it('two tapin~ / tapout~ pairs each read their own line', () => {
    // The regression this guards: a module-level "most recent tapin~" made the second
    // pair in a patch (the right channel of a stereo delay) read the first pair's line.
    const a = build('tapin~', 1000);
    const b = build('tapin~', 1000);
    const tapA = build('tapout~', 250);
    const tapB = build('tapout~', 250);
    const connected: unknown[] = [];
    for (const [tapin, tapout] of [[a, tapA], [b, tapB]] as const) {
      const input = tapin.node.signalIns[0] as unknown as { connect: (n: unknown) => unknown };
      const original = input.connect.bind(input);
      input.connect = (n: unknown) => { connected.push([tapin, n]); return original(n); };
      tapin.node.onControlOut!(0, tapout.node.controlIns![0]!);
    }
    // Each tap reads its line twice: once on time, and once a render quantum early for
    // cords that go back round a feedback loop.
    expect(connected.length).toBe(4);
    expect(connected.map((c) => (c as unknown[])[0])).toEqual([a, a, b, b]);
    expect(new Set(connected.map((c) => (c as unknown[])[1])).size).toBe(4);
  });

  it('tapout~ offers an early output per tap for cords that close a loop', () => {
    const { node } = build('tapout~', 100, 200);
    expect(node.signalOuts.length).toBe(2);
    expect(node.loopOuts?.length).toBe(2);
    expect(node.loopOuts?.every(Boolean)).toBe(true);
    expect(node.loopOuts?.[0]).not.toBe(node.signalOuts[0]);
  });

  it('tapout~ accepts a tap time before and after it is linked', () => {
    const tapin = build('tapin~', 1000);
    const { node, send } = build('tapout~', 0);
    expect(() => send([100])).not.toThrow();
    tapin.node.onControlOut!(0, node.controlIns![0]!);
    expect(() => send([200])).not.toThrow();
    expect(() => node.dispose?.()).not.toThrow();
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
