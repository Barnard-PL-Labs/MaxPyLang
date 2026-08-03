// Structural tests for the AudioWorklet-backed MSP objects. In Node the worklet
// module is never loaded (the headless mock can't run worklets), so every factory
// MUST take its pass-through fallback and still build with the manifest I/O arity and
// swallow control messages without throwing. Acoustic correctness is proven by the
// kernel tests (test/dsp/kernels.test.ts); the worklet path is exercised in browser
// mode (test/browser/, npm run test:browser).

import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/worklet-dsp'; // self-registering
import { getFactory, MANIFEST } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;
const build = (name: string, ...args: (number | string)[]) => getFactory(name)!(args, { ctx });

const OBJECTS = ['biquad~', '+=~', 'rampsmooth~', 'deltaclip~', 'allpass~'];

describe('worklet DSP objects (fallback path in Node)', () => {
  it('builds each with the manifest inlet/outlet arity and a live signal outlet', () => {
    for (const name of OBJECTS) {
      const entry = MANIFEST[name];
      const node = build(name);
      expect(node.signalIns.length, `${name} inlet count`).toBe(entry.numInlets);
      expect(node.signalOuts[0], `${name} signal outlet 0`).toBeTruthy();
      expect(node.signalIns[0], `${name} signal inlet 0`).toBeTruthy();
    }
  });

  it('accepts control messages on every inlet without throwing', () => {
    for (const name of OBJECTS) {
      const node = build(name, 1, 2, 3, 4, 5);
      node.controlIns?.forEach((fn) => fn?.([0.5] as Msg));
    }
    expect(true).toBe(true);
  });

  it('builds with empty and garbage args (fuzz-safe)', () => {
    const garbage = ['???', Number.NaN, -1, 1e9, 'bang'];
    for (const name of OBJECTS) {
      expect(() => build(name)).not.toThrow();
      expect(() => build(name, ...garbage)).not.toThrow();
    }
  });
});
