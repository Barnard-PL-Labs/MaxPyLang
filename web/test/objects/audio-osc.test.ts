import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/audio/osc'; // direct import — isolates this batch from others
import { getFactory, MANIFEST } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

// A genuine (mock) Web Audio context, per the batch contract.
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const capture = (outlet: number) => {
    const out: Msg[] = [];
    node.onControlOut?.(outlet, (m) => out.push(m));
    return out;
  };
  return { node, send, capture };
}

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('osc batch: all objects build with manifest arity', () => {
  for (const name of ['saw~', 'rect~', 'tri~', 'noise~', 'pink~', 'train~']) {
    it(`${name} builds and exposes each signal outlet`, () => {
      const entry = MANIFEST[name];
      const { node } = build(name);
      entry.outletDomains.forEach((domain, i) => {
        if (domain === 'signal') expect(node.signalOuts[i]).toBeDefined();
      });
    });
  }
});

describe('oscillator frequency args and control', () => {
  it('saw~ 220 lands on the frequency AudioParam', () => {
    const { node } = build('saw~', 220);
    expect((node.signalIns[0] as AudioParam).value).toBe(220);
  });

  it('saw~ float message updates the frequency param', () => {
    const { node, send } = build('saw~', 220);
    send([330]);
    expect((node.signalIns[0] as AudioParam).value).toBe(330);
  });

  it('rect~ 440 lands on the frequency AudioParam', () => {
    const { node } = build('rect~', 440);
    expect((node.signalIns[0] as AudioParam).value).toBe(440);
  });

  it('tri~ 100 lands on the frequency AudioParam and updates on message', () => {
    const { node, send } = build('tri~', 100);
    expect((node.signalIns[0] as AudioParam).value).toBe(100);
    send([200]);
    expect((node.signalIns[0] as AudioParam).value).toBe(200);
  });
});

describe('noise sources', () => {
  it('noise~ and pink~ each expose one signal outlet', () => {
    expect(build('noise~').node.signalOuts[0]).toBeDefined();
    expect(build('pink~').node.signalOuts[0]).toBeDefined();
  });
});

describe('train~ control outlet', () => {
  it('emits a bang per pulse on outlet 1 while the transport runs', () => {
    vi.useFakeTimers();
    const { capture } = build('train~', 100);
    const bangs = capture(1);
    scheduler.start();
    vi.advanceTimersByTime(350);
    expect(bangs.length).toBe(3);
    expect(bangs.every((m) => m[0] === 'bang')).toBe(true);
  });

  it('reschedules when the interval inlet changes', () => {
    vi.useFakeTimers();
    const { send, capture } = build('train~', 1000);
    const bangs = capture(1);
    scheduler.start();
    send([100]); // faster: every 100ms
    vi.advanceTimersByTime(250);
    expect(bangs.length).toBe(2);
  });

  it('has a signal outlet and a control (undefined-signal) outlet', () => {
    const { node } = build('train~', 100);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalOuts[1]).toBeUndefined();
  });
});
