import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/timing'; // direct import — isolated from other batches
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a control object and capture messages on any outlet.
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
const bang: Msg = ['bang'];

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear(); // reset the shared transport between tests
});

describe('timing objects', () => {
  it('qmetro bangs every interval only while the transport runs', () => {
    vi.useFakeTimers();
    const { outs, capture } = build('qmetro', 100);
    capture(0);
    scheduler.start();
    vi.advanceTimersByTime(350);
    expect(outs[0].length).toBe(3);
    expect(outs[0].every((m) => m[0] === 'bang')).toBe(true);
    scheduler.stop();
    vi.advanceTimersByTime(500);
    expect(outs[0].length).toBe(3); // no ticks after ■
  });

  it('tempo emits an incrementing count at a BPM-derived interval', () => {
    vi.useFakeTimers();
    // 120 BPM, mult 1, div 1 -> one beat = 500ms
    const { outs, capture, send } = build('tempo', 120);
    capture(0);
    scheduler.start();
    send([1]); // turn on
    vi.advanceTimersByTime(1600); // 3 ticks at 500ms
    expect(outs[0].map((m) => m[0])).toEqual([0, 1, 2]);
  });

  it('tempo stops and resets its count on a 0', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('tempo', 120);
    capture(0);
    scheduler.start();
    send([1]); // turn on
    vi.advanceTimersByTime(1100); // 0, 1
    send([0]);
    vi.advanceTimersByTime(1100);
    send([1]); // restart
    vi.advanceTimersByTime(600); // 0
    expect(outs[0].map((m) => m[0])).toEqual([0, 1, 0]);
  });

  it('clocker reports cumulative elapsed time and resets on stop', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('clocker', 100);
    capture(0);
    scheduler.start();
    send(bang); // start
    vi.advanceTimersByTime(350);
    expect(outs[0].map((m) => m[0])).toEqual([100, 200, 300]);
    send([0]); // stop + reset
    outs[0].length = 0;
    send([1]); // restart
    vi.advanceTimersByTime(150);
    expect(outs[0].map((m) => m[0])).toEqual([100]);
  });

  it('pipe delays a value by ms; multiple values stay in flight', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('pipe', 100);
    capture(0);
    scheduler.start();
    send([5]);
    vi.advanceTimersByTime(50);
    send([9]);
    expect(outs[0].length).toBe(0); // nothing yet
    vi.advanceTimersByTime(50); // 5 fires at t=100
    expect(outs[0].map((m) => m[0])).toEqual([5]);
    vi.advanceTimersByTime(50); // 9 fires at t=150
    expect(outs[0].map((m) => m[0])).toEqual([5, 9]);
  });

  it('pipe delay is settable from the right inlet', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('pipe', 100);
    capture(0);
    scheduler.start();
    send([200], 1); // set delay to 200
    send([7]);
    vi.advanceTimersByTime(150);
    expect(outs[0].length).toBe(0);
    vi.advanceTimersByTime(100);
    expect(outs[0].map((m) => m[0])).toEqual([7]);
  });

  it('line ramps to target over time and bangs when done', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('line', 0, 20); // start 0, grain 20
    capture(0);
    capture(1);
    scheduler.start();
    send([10, 100]); // ramp 0 -> 10 over 100ms, 5 steps of 20ms
    vi.advanceTimersByTime(100);
    expect(outs[0].map((m) => m[0])).toEqual([2, 4, 6, 8, 10]);
    expect(outs[1].length).toBe(1); // one done-bang
    expect(outs[1][0][0]).toBe('bang');
  });

  it('line jumps immediately on a lone number', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('line', 0, 20);
    capture(0);
    capture(1);
    scheduler.start();
    send([42]);
    expect(outs[0].map((m) => m[0])).toEqual([42]);
    expect(outs[1].length).toBe(1);
  });

  it('uzi fires N bangs with an index count and a carry-bang', () => {
    const { outs, capture, send } = build('uzi', 3);
    capture(0);
    capture(1);
    capture(2);
    send(bang);
    expect(outs[0].length).toBe(3);
    expect(outs[0].every((m) => m[0] === 'bang')).toBe(true);
    expect(outs[1].map((m) => m[0])).toEqual([1, 2, 3]); // 1-based index
    expect(outs[2].length).toBe(1); // carry-bang once
  });

  it('uzi base offsets the index and a number sets the count', () => {
    const { outs, capture, send } = build('uzi', 1, 10); // count 1, base 10
    capture(0);
    capture(1);
    send([2]); // set count 2 and fire
    expect(outs[0].length).toBe(2);
    expect(outs[1].map((m) => m[0])).toEqual([11, 12]);
  });

  it('speedlim passes the first message and holds the rest within the window', () => {
    vi.useFakeTimers();
    const { outs, capture, send } = build('speedlim', 100);
    capture(0);
    scheduler.start();
    send([1]); // passes immediately
    send([2]); // held
    send([3]); // held (replaces 2)
    expect(outs[0].map((m) => m[0])).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(outs[0].map((m) => m[0])).toEqual([1, 3]); // most-recent held value
  });
});
