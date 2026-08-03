import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/sigmath'; // register the "sigmath" batch only
import { getFactory, MANIFEST } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// A genuine (mocked) Web Audio context — the headless mock is installed by setup.
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, send };
}

// Every implemented class matches the manifest's inlet/outlet arity and domains.
const IMPLEMENTED = ['sig~', 'abs~', 'sqrt~', 'pow~', '/~', '!-~', '!/~'];

describe('sigmath batch', () => {
  it('registers every implemented class', () => {
    for (const name of IMPLEMENTED) expect(getFactory(name)).toBeTypeOf('function');
  });

  it('matches manifest arity + signal outlets for each class', () => {
    for (const name of IMPLEMENTED) {
      const entry = MANIFEST[name];
      const { node } = build(name);
      // Every signal outlet declared in the manifest must be a real node.
      entry.outletDomains.forEach((d, i) => {
        if (d === 'signal') expect(node.signalOuts[i], `${name} outlet ${i}`).toBeDefined();
      });
      // Signal inlets exist up to the declared inlet count (control-only inlets may be undefined).
      expect(node.signalIns.length).toBeLessThanOrEqual(entry.numInlets + 0.0001);
    }
  });

  it('sig~ : arg sets the constant, control float updates it', () => {
    const { node, send } = build('sig~', 0.25);
    const offset = node.signalIns[0] as AudioParam;
    expect(offset.value).toBeCloseTo(0.25);
    expect(node.signalOuts[0]).toBeDefined();
    send([0.5]);
    expect(offset.value).toBeCloseTo(0.5);
  });

  it('/~ : divisor arg becomes reciprocal gain, control float updates it', () => {
    const { node, send } = build('/~', 4);
    const gain = node.signalOuts[0] as unknown as { gain: AudioParam };
    expect(gain.gain.value).toBeCloseTo(0.25);
    send([2], 1); // right inlet = divisor
    expect(gain.gain.value).toBeCloseTo(0.5);
  });

  it('/~ : divide-by-zero yields silence (gain 0) not Infinity', () => {
    const { node } = build('/~', 0);
    const gain = node.signalOuts[0] as unknown as { gain: AudioParam };
    expect(gain.gain.value).toBe(0);
  });

  it('!-~ : arg lands on the constant offset (inlet 1), control float updates it', () => {
    const { node, send } = build('!-~', 3);
    const offset = node.signalIns[1] as AudioParam;
    expect(offset.value).toBeCloseTo(3);
    send([1.5], 1);
    expect(offset.value).toBeCloseTo(1.5);
  });

  it('!/~ : builds with a signal outlet and takes a control numerator without throwing', () => {
    const { node, send } = build('!/~', 8);
    expect(node.signalOuts[0]).toBeDefined();
    expect(() => send([2], 1)).not.toThrow();
  });

  it('pow~ : builds, exposes a signal outlet, and accepts a control exponent', () => {
    const { node, send } = build('pow~', 2);
    expect(node.signalOuts[0]).toBeDefined();
    expect(() => send([3], 1)).not.toThrow();
  });

  it('abs~ / sqrt~ : single-in single-out shapers build cleanly', () => {
    for (const name of ['abs~', 'sqrt~']) {
      const { node } = build(name);
      expect(node.signalIns[0]).toBeDefined();
      expect(node.signalOuts[0]).toBeDefined();
    }
  });

  it('dispose() on sig~ / !-~ does not throw', () => {
    expect(() => build('sig~', 1).node.dispose?.()).not.toThrow();
    expect(() => build('!-~', 1).node.dispose?.()).not.toThrow();
  });
});
