import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/audio/analysis'; // direct import — isolates from other batches
import { getFactory, MANIFEST } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

// Headless Web Audio mock is installed by test/setup/webaudio-mock.ts.
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const listen = (outlet: number) => {
    outs[outlet] = outs[outlet] ?? [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, listen, send };
}

afterEach(() => {
  scheduler.clear(); // reset the shared transport between tests
  vi.useRealTimers();
});

describe('analysis batch', () => {
  // ── manifest arity: every object matches numInlets/numOutlets/outletDomains ──
  it('matches the manifest I/O for every implemented object', () => {
    for (const name of ['meter~', 'snapshot~', 'avg~', 'peakamp~', 'number~', 'thresh~', 'edge~']) {
      const entry = MANIFEST[name];
      const { node } = build(name);
      expect(node.signalIns.length, `${name} inlets`).toBe(entry.numInlets);
      expect(node.signalOuts.length, `${name} outlets`).toBe(entry.numOutlets);
      entry.outletDomains.forEach((d, i) => {
        if (d === 'signal') expect(node.signalOuts[i], `${name} signal outlet ${i}`).toBeDefined();
        else expect(node.signalOuts[i], `${name} control outlet ${i}`).toBeUndefined();
      });
    }
  });

  // ── meter~ : periodic peak report on a control outlet ────────────────────────
  it('meter~ taps a signal inlet and emits a numeric level while running', () => {
    const { node, outs, listen } = build('meter~');
    expect(node.signalIns[0]).toBeDefined(); // signal in (analyser tap)
    listen(0);
    vi.useFakeTimers();
    scheduler.start();
    vi.advanceTimersByTime(600); // > 2 report intervals
    expect(outs[0].length).toBeGreaterThan(0);
    expect(typeof outs[0][0][0]).toBe('number');
  });

  // ── snapshot~ : bang samples now; interval drives periodic reports ───────────
  it('snapshot~ emits a number on bang to the signal inlet', () => {
    const { outs, listen, send } = build('snapshot~');
    listen(0);
    send(['bang'], 0);
    expect(outs[0].length).toBe(1);
    expect(typeof outs[0][0][0]).toBe('number');
  });

  it('snapshot~ interval arg drives periodic reports on the transport clock', () => {
    const { outs, listen } = build('snapshot~', 50);
    listen(0);
    vi.useFakeTimers();
    scheduler.start();
    vi.advanceTimersByTime(170); // ~3 ticks at 50ms
    expect(outs[0].length).toBeGreaterThanOrEqual(3);
  });

  // ── avg~ : reports on bang ───────────────────────────────────────────────────
  it('avg~ emits a numeric average on bang', () => {
    const { outs, listen, send } = build('avg~');
    listen(0);
    send(['bang'], 0);
    expect(outs[0].length).toBe(1);
    expect(typeof outs[0][0][0]).toBe('number');
  });

  // ── peakamp~ : bang reports peak; right inlet sets interval ──────────────────
  it('peakamp~ emits peak on bang to inlet 0', () => {
    const { outs, listen, send } = build('peakamp~');
    listen(0);
    send(['bang'], 0);
    expect(outs[0].length).toBe(1);
    expect(typeof outs[0][0][0]).toBe('number');
  });

  it('peakamp~ interval arg drives periodic reports', () => {
    const { outs, listen } = build('peakamp~', 40);
    listen(0);
    vi.useFakeTimers();
    scheduler.start();
    vi.advanceTimersByTime(130); // ~3 ticks at 40ms
    expect(outs[0].length).toBeGreaterThanOrEqual(3);
  });

  // ── number~ : signal pass-through + control value report ─────────────────────
  it('number~ passes signal through outlet 0 and reports set-values on outlet 1', () => {
    const { node, outs, listen, send } = build('number~');
    expect(node.signalIns[0]).toBeDefined();     // signal in
    expect(node.signalOuts[0]).toBeDefined();    // outlet 0 signal (pass-through)
    expect(node.signalOuts[1]).toBeUndefined();  // outlet 1 control
    listen(1);
    send([42], 1); // set value -> reports on control outlet 1
    expect(outs[1].some((m) => m[0] === 42)).toBe(true);
  });

  // ── thresh~ : signal->signal gate; thresholds update without throwing ────────
  it('thresh~ builds a signal in/out and accepts threshold floats', () => {
    const { node, send } = build('thresh~', 0.1, 0.9);
    expect(node.signalIns[0]).toBeDefined();  // signal in
    expect(node.signalOuts[0]).toBeDefined(); // signal out
    expect(node.signalIns[1]).toBeUndefined(); // inlet 1 is control (threshold)
    expect(() => { send([0.2], 1); send([0.8], 2); }).not.toThrow();
  });

  // ── edge~ : two control outlets, dispose cancels the poller ──────────────────
  it('edge~ exposes two control outlets and a dispose', () => {
    const { node } = build('edge~');
    expect(node.signalIns[0]).toBeDefined();
    expect(node.signalOuts[0]).toBeUndefined();
    expect(node.signalOuts[1]).toBeUndefined();
    expect(typeof node.onControlOut).toBe('function');
    expect(typeof node.dispose).toBe('function');
    expect(() => node.dispose!()).not.toThrow();
  });
});
