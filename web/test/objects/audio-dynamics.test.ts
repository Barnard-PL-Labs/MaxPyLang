import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/dynamics'; // direct import — isolates from other batches
import { getFactory, MANIFEST } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// Headless Web Audio mock is installed by test/setup/webaudio-mock.ts.
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  return getFactory(className)!(args, { ctx });
}

// Every signal outlet the manifest declares must be a real AudioNode.
function assertSignalOutlets(className: string, node: ReturnType<typeof build>) {
  const entry = MANIFEST[className];
  entry.outletDomains.forEach((domain, i) => {
    if (domain === 'signal') expect(node.signalOuts[i], `signal outlet ${i}`).toBeDefined();
  });
  expect(node.signalOuts.length).toBe(entry.numOutlets);
}

describe('limi~', () => {
  it('builds a compressor and exposes its signal in/out', () => {
    const node = build('limi~');
    assertSignalOutlets('limi~', node);
    expect(node.signalIns[0]).toBeDefined();
    // limiter is one node feeding itself through
    expect(node.signalIns[0]).toBe(node.signalOuts[0]);
  });
});

describe('degrade~', () => {
  it('builds a waveshaper with 3 inlets / 1 signal outlet', () => {
    const node = build('degrade~', 0.5, 8);
    assertSignalOutlets('degrade~', node);
    expect(node.signalIns.length).toBe(MANIFEST['degrade~'].numInlets);
    expect(node.signalIns[0]).toBeDefined(); // signal input
  });

  it('accepts bits (inlet 2) and ratio (inlet 1) control messages without throwing', () => {
    const node = build('degrade~');
    expect(() => node.controlIns?.[1]?.([0.25] as Msg)).not.toThrow();
    expect(() => node.controlIns?.[2]?.([4] as Msg)).not.toThrow();
  });
});

describe('gate~', () => {
  it('starts closed by default (gain 0)', () => {
    const node = build('gate~');
    const gain = node.signalOuts[0] as unknown as { gain: { value: number } };
    expect(gain.gain.value).toBe(0);
  });

  it('starts open when initial-open-outlet arg is set', () => {
    const node = build('gate~', 1, 1);
    const gain = node.signalOuts[0] as unknown as { gain: { value: number } };
    expect(gain.gain.value).toBe(1);
  });

  it('control inlet 0 opens (>=1) and closes (0) the gate', () => {
    const node = build('gate~');
    const gain = node.signalOuts[0] as unknown as { gain: { value: number } };
    node.controlIns?.[0]?.([1] as Msg);
    expect(gain.gain.value).toBe(1);
    node.controlIns?.[0]?.([0] as Msg);
    expect(gain.gain.value).toBe(0);
  });

  it('routes the signal on inlet 1, not inlet 0', () => {
    const node = build('gate~');
    expect(node.signalIns[0]).toBeUndefined();
    expect(node.signalIns[1]).toBeDefined();
  });
});

describe('round~', () => {
  it('builds a waveshaper with 2 inlets / 1 signal outlet', () => {
    const node = build('round~', 0.5);
    assertSignalOutlets('round~', node);
    expect(node.signalIns.length).toBe(MANIFEST['round~'].numInlets);
    expect(node.signalIns[0]).toBeDefined();
  });

  it('accepts a new rounding factor on inlet 1 without throwing', () => {
    const node = build('round~');
    expect(() => node.controlIns?.[1]?.([0.25] as Msg)).not.toThrow();
  });
});
