import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/filters'; // direct import — isolated from other batches
import { getFactory, MANIFEST } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// A genuine (mocked) Web Audio context — see test/setup/webaudio-mock.ts.
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  return getFactory(className)!(args, { ctx });
}
const val = (p: unknown) => (p as { value: number }).value;

describe('audio filter objects', () => {
  it('builds every implemented object with the manifest I/O arity', () => {
    for (const name of ['onepole~', 'svf~', 'reson~', 'cross~', 'teeth~']) {
      const entry = MANIFEST[name];
      const node = build(name);
      // Every signal outlet has a real AudioNode source.
      const sigOutlets = entry.outletDomains.filter((d) => d === 'signal').length;
      for (let i = 0; i < entry.numOutlets; i++) {
        if (entry.outletDomains[i] === 'signal') expect(node.signalOuts[i]).toBeTruthy();
      }
      expect(node.signalOuts.filter(Boolean).length).toBe(sigOutlets);
      // signalIns spans the inlet count (inlet 0 is always the signal input).
      expect(node.signalIns[0]).toBeTruthy();
      expect(node.signalIns.length).toBe(entry.numInlets);
    }
  });

  it('onepole~ maps the frequency arg and the freq inlet to the biquad', () => {
    const node = build('onepole~', 500);
    expect(val(node.signalIns[1])).toBe(500);
    node.controlIns![1]!([1200] as Msg);
    expect(val(node.signalIns[1])).toBe(1200);
  });

  it('svf~ exposes four signal outlets and syncs freq/Q across them', () => {
    const node = build('svf~', 800, 3);
    expect(node.signalOuts.length).toBe(4);
    expect(node.signalOuts.every(Boolean)).toBe(true);
    expect(val(node.signalIns[1])).toBe(800); // center frequency arg
    expect(val(node.signalIns[2])).toBe(3);   // resonance -> Q arg
    node.controlIns![1]!([2000] as Msg);
    node.controlIns![2]!([9] as Msg);
    // The lowpass (exposed on the signal inlets) tracks the control messages.
    expect(val(node.signalIns[1])).toBe(2000);
    expect(val(node.signalIns[2])).toBe(9);
  });

  it('reson~ lands gain/frequency/Q args on the right params', () => {
    const node = build('reson~', 2, 1500, 5);
    expect(val(node.signalIns[1])).toBe(2);    // gain
    expect(val(node.signalIns[2])).toBe(1500); // center frequency
    expect(val(node.signalIns[3])).toBe(5);    // Q
    node.controlIns![2]!([600] as Msg);
    expect(val(node.signalIns[2])).toBe(600);
  });

  it('cross~ has two outlets and its cutoff inlet moves both bands', () => {
    const node = build('cross~', 1200);
    expect(node.signalOuts.length).toBe(2);
    expect(node.signalOuts.every(Boolean)).toBe(true);
    expect(val(node.signalIns[1])).toBe(1200);
    node.controlIns![1]!([3000] as Msg);
    expect(val(node.signalIns[1])).toBe(3000);
  });

  it('teeth~ has 6 inlets, 1 signal outlet, and lands its gain args', () => {
    const node = build('teeth~', 100, 200, 0.5, 0.3, 0.4);
    expect(node.signalIns.length).toBe(6);
    expect(node.signalOuts[0]).toBeTruthy();
    expect(val(node.signalIns[3])).toBe(0.5); // overall gain
    expect(val(node.signalIns[4])).toBe(0.3); // feedforward gain
    expect(val(node.signalIns[5])).toBe(0.4); // feedback gain
    node.controlIns![4]!([0.9] as Msg);
    expect(val(node.signalIns[4])).toBe(0.9);
  });
});
