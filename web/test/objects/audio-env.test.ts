import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/audio/env'; // direct import — isolated from other batches
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

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

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('env batch audio objects', () => {
  it('line~ builds with a signal outlet + control outlet and seeds its initial value', () => {
    const { node } = build('line~', 0.5);
    expect(node.signalOuts[0]).toBeDefined();          // signal ramp out
    expect(node.signalOuts[1]).toBeUndefined();        // outlet 1 is control
    expect((node.signalOuts[0] as any).offset.value).toBe(0.5);
  });

  it('line~ ramps offset toward the target and bangs when the ramp finishes', () => {
    vi.useFakeTimers();
    const { node, outs, capture, send } = build('line~', 0);
    capture(1);
    scheduler.start();
    send([10, 100]); // ramp 0 -> 10 over 100ms
    expect((node.signalOuts[0] as any).offset.value).toBe(10); // mock lands on target
    expect(outs[1].length).toBe(0); // not done yet
    vi.advanceTimersByTime(100);
    expect(outs[1].length).toBe(1);
    expect(outs[1][0][0]).toBe('bang');
  });

  it('line~ jumps immediately and bangs on a lone number', () => {
    const { node, outs, capture, send } = build('line~', 0);
    capture(1);
    send([42]);
    expect((node.signalOuts[0] as any).offset.value).toBe(42);
    expect(outs[1].map((m) => m[0])).toEqual(['bang']);
  });

  it('curve~ builds, seeds initial value, and ramps its offset', () => {
    const { node, send } = build('curve~', 1, 0);
    expect(node.signalOuts[0]).toBeDefined();
    expect((node.signalOuts[0] as any).offset.value).toBe(1);
    send([5, 50]);
    expect((node.signalOuts[0] as any).offset.value).toBe(5);
  });

  it('adsr~ builds with two signal outlets and two control outlets', () => {
    const { node } = build('adsr~', 10, 20, 0.7, 30);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalOuts[1]).toBeDefined();
    expect(node.signalOuts[2]).toBeUndefined();
    expect(node.signalOuts[3]).toBeUndefined();
    expect(node.signalIns.length).toBe(5); // 5 inlets per manifest
  });

  it('adsr~ gate drives the envelope offset and reports phase-done bangs', () => {
    vi.useFakeTimers();
    const { node, outs, capture, send } = build('adsr~', 10, 20, 0.7, 30);
    capture(2); // end of attack+decay
    capture(3); // end of release
    scheduler.start();
    send([1]); // note on
    expect((node.signalOuts[0] as any).offset.value).toBe(0.7); // lands on sustain
    vi.advanceTimersByTime(30); // attack(10)+decay(20)
    expect(outs[2].map((m) => m[0])).toEqual(['bang']);
    send([0]); // note off
    expect((node.signalOuts[0] as any).offset.value).toBe(0); // release to 0
    vi.advanceTimersByTime(30);
    expect(outs[3].map((m) => m[0])).toEqual(['bang']);
  });

  it('trapezoid~ builds a single signal outlet and accepts ramp-fraction inlets', () => {
    const { node, send } = build('trapezoid~', 0.2, 0.2);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalOuts.length).toBe(1);
    expect(node.signalIns[0]).toBeDefined(); // signal passes through the shaper
    // control inlets rebuild the curve without throwing
    expect(() => send([0.3], 1)).not.toThrow();
    expect(() => send([0.1], 2)).not.toThrow();
  });
});
