import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/flow'; // direct import — isolated from other batches
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
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
  scheduler.clear();
});

describe('change', () => {
  it('emits value only when it differs from the previous', () => {
    const { capture, send } = build('change');
    const val = capture(0);
    send([5]); send([5]); send([7]); send([7]); send([2]);
    expect(val.map((m) => m[0])).toEqual([5, 7, 2]);
  });

  it('initial-value arg suppresses a matching first input', () => {
    const { capture, send } = build('change', 0);
    const val = capture(0);
    send([0]); send([3]);
    expect(val.map((m) => m[0])).toEqual([3]);
  });

  it('direction outlets report increase / decrease', () => {
    const { capture, send } = build('change', 0);
    const up = capture(1);
    const down = capture(2);
    send([5]); // up
    send([2]); // down
    send([2]); // equal
    expect(up.map((m) => m[0])).toEqual([1, 0, 0]);
    expect(down.map((m) => m[0])).toEqual([0, 1, 0]);
  });

  it('bang re-emits stored value; set stores silently', () => {
    const { capture, send } = build('change');
    const val = capture(0);
    send([9]);
    send(['set', 4]); // stored, no output
    send(bang);       // re-emits 4
    expect(val.map((m) => m[0])).toEqual([9, 4]);
  });
});

describe('accum', () => {
  it('stores+outputs on left, adds on middle, multiplies on right', () => {
    const { capture, send } = build('accum', 10);
    const out = capture(0);
    send(bang);        // 10
    send([5], 1);      // += 5 -> 15 (no output)
    send(bang);        // 15
    send([2], 2);      // *= 2 -> 30 (no output)
    send(bang);        // 30
    send([100]);       // store+output 100
    send(bang);        // 100
    expect(out.map((m) => m[0])).toEqual([10, 15, 30, 100, 100]);
  });
});

describe('histo', () => {
  it('increments a bin and outputs value then count', () => {
    const { capture, send } = build('histo');
    const count = capture(0);
    const value = capture(1);
    send([5]); send([5]); send([9]);
    expect(value.map((m) => m[0])).toEqual([5, 5, 9]);
    expect(count.map((m) => m[0])).toEqual([1, 2, 1]);
  });

  it('bang dumps all bins ascending; clear resets', () => {
    const { capture, send } = build('histo');
    send([9]); send([5]); send([5]);
    const count = capture(0);
    const value = capture(1);
    send(bang);
    expect(value.map((m) => m[0])).toEqual([5, 9]);
    expect(count.map((m) => m[0])).toEqual([2, 1]);
    send(['clear'], 1);
    value.length = 0; count.length = 0;
    send(bang);
    expect(value.length).toBe(0);
  });
});

describe('past', () => {
  it('bangs on crossing above threshold, re-arms below', () => {
    const { capture, send } = build('past', 64);
    const out = capture(0);
    send([50]);   // below
    send([64]);   // crosses -> bang
    send([70]);   // still above, no bang
    send([40]);   // drops below
    send([80]);   // crosses again -> bang
    expect(out.length).toBe(2);
    expect(out.every((m) => m[0] === 'bang')).toBe(true);
  });

  it('supports multiple thresholds', () => {
    const { capture, send } = build('past', 10, 20);
    const out = capture(0);
    send([5]); send([12]); send([25]);
    expect(out.length).toBe(2); // crossed 10, then 20
  });
});

describe('peak / trough', () => {
  it('peak emits new maxima, flags, and passes through', () => {
    const { capture, send } = build('peak');
    const value = capture(0);
    const flag = capture(1);
    const thru = capture(2);
    send([3]); send([1]); send([7]);
    expect(value.map((m) => m[0])).toEqual([3, 7]);
    expect(flag.map((m) => m[0])).toEqual([1, 0, 1]);
    expect(thru.map((m) => m[0])).toEqual([3, 1, 7]);
  });

  it('peak right inlet resets, bang re-emits current max', () => {
    const { capture, send } = build('peak');
    const value = capture(0);
    send([7]);
    send([100], 1); // reset current max to 100
    send([50]);     // not a new max
    send(bang);     // re-emit 100
    expect(value.map((m) => m[0])).toEqual([7, 100]);
  });

  it('trough emits new minima', () => {
    const { capture, send } = build('trough');
    const value = capture(0);
    send([5]); send([9]); send([2]);
    expect(value.map((m) => m[0])).toEqual([5, 2]);
  });
});

describe('offer', () => {
  it('stores from a [addr value] list and recalls by address', () => {
    const { capture, send } = build('offer');
    const out = capture(0);
    send([3, 42]);   // store 42 at 3, output 42
    send([7, 99]);   // store 99 at 7, output 99
    send([3]);       // recall 42
    send([5]);       // no value stored -> 0
    expect(out.map((m) => m[0])).toEqual([42, 99, 42, 0]);
  });

  it('right inlet primes a value stored at the next address', () => {
    const { capture, send } = build('offer');
    const out = capture(0);
    send([8], 1);    // pending value 8
    send([2]);       // store 8 at 2, output 8
    send([2]);       // recall 8
    expect(out.map((m) => m[0])).toEqual([8, 8]);
  });
});

describe('bondo', () => {
  it('left inlet triggers synchronised output of all stored values (no delay)', () => {
    const { capture, send } = build('bondo');
    const left = capture(0);
    const right = capture(1);
    send([20], 1);   // store into right, no trigger
    expect(right.length).toBe(0);
    send([10], 0);   // trigger
    expect(left.map((m) => m[0])).toEqual([10]);
    expect(right.map((m) => m[0])).toEqual([20]);
  });

  it('delays synchronised output via the scheduler', () => {
    vi.useFakeTimers();
    const { capture, send } = build('bondo', 2, 100);
    const left = capture(0);
    scheduler.start();
    send([5], 1);
    send(bang, 0); // trigger with 100ms delay
    expect(left.length).toBe(0);
    vi.advanceTimersByTime(100);
    expect(left.length).toBe(1);
    expect(left[0][0]).toBe('bang');
  });
});
