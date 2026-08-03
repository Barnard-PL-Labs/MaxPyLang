import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/triggers'; // direct import — isolated from other batches
import { simulateKey, simulateKeyUp } from '../../src/objects/control/triggers';
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context
const bang: Msg = ['bang'];

// Build a control object and capture messages on any outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Msg[][] = [];
  const capture = (outlet: number) => {
    outs[outlet] ??= [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
    return outs[outlet];
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, capture, send };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('load-time bangs', () => {
  it('loadbang emits a single bang on start (load), once', () => {
    const { node, capture } = build('loadbang');
    const out = capture(0);
    node.start?.();
    node.start?.(); // a second start must not re-fire
    expect(out).toEqual([bang]);
  });

  it('loadbang re-outputs a bang when banged', () => {
    const { capture, send } = build('loadbang');
    const out = capture(0);
    send(bang);
    expect(out).toEqual([bang]);
  });

  it('loadmess emits its creation args on start', () => {
    const { node, capture } = build('loadmess', 1, 2, 3);
    const out = capture(0);
    node.start?.();
    expect(out).toEqual([[1, 2, 3]]);
  });

  it('loadmess with no args emits a bang, and re-outputs on bang', () => {
    const { node, capture, send } = build('loadmess');
    const out = capture(0);
    node.start?.();
    send(bang);
    expect(out).toEqual([bang, bang]);
  });
});

describe('free-time bangs', () => {
  it('closebang emits a bang on dispose, not before', () => {
    const { node, capture } = build('closebang');
    const out = capture(0);
    expect(out).toEqual([]);
    node.dispose?.();
    expect(out).toEqual([bang]);
  });

  it('freebang emits a bang on dispose', () => {
    const { node, capture } = build('freebang');
    const out = capture(0);
    node.dispose?.();
    expect(out).toEqual([bang]);
  });
});

describe('active', () => {
  it('echoes a normalized 0/1 state and re-reports on bang', () => {
    const { capture, send } = build('active');
    const out = capture(0);
    send([5]);     // nonzero -> 1
    send([0]);     // -> 0
    send(bang);    // re-report last (0)
    expect(out.map((m) => m[0])).toEqual([1, 0, 0]);
  });
});

describe('clocks', () => {
  it('date reports day/month/year across three outlets on a bang', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2)); // month index 7 == August
    const { capture, send } = build('date');
    const day = capture(0);
    const month = capture(1);
    const year = capture(2);
    send(bang);
    expect(day[0]).toEqual([2]);
    expect(month[0]).toEqual([8]);
    expect(year[0]).toEqual([2026]);
  });

  it('cpuclock outputs a numeric timestamp on a bang', () => {
    const { capture, send } = build('cpuclock');
    const out = capture(0);
    send(bang);
    expect(out.length).toBe(1);
    expect(typeof out[0][0]).toBe('number');
  });
});

describe('keyboard sources', () => {
  it('key has no inlets and four outlets, and passes a simulated press through', () => {
    const { node, capture } = build('key');
    expect(node.controlIns?.length ?? 0).toBe(0);
    const charOut = capture(0);
    const rawOut = capture(3);
    simulateKey(65); // 'A'
    expect(charOut).toEqual([[65]]);
    expect(rawOut).toEqual([[65]]);
    node.dispose?.(); // unregister so later tests are clean
  });

  it('keyup passes a simulated release through and is independent of key', () => {
    const k = build('key');
    const u = build('keyup');
    const keyOut = k.capture(0);
    const upOut = u.capture(0);
    simulateKeyUp(66); // 'B'
    expect(upOut).toEqual([[66]]);
    expect(keyOut).toEqual([]); // key source unaffected by a keyup
    k.node.dispose?.();
    u.node.dispose?.();
  });
});
