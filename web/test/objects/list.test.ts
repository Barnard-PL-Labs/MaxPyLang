import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/list'; // self-registering module under test (no glob bootstrap)
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context
const bang: Msg = ['bang'];

// Build a control object and capture every outlet's messages.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const cap = (outlet: number) => {
    outs[outlet] = [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  for (let i = 0; i < 4; i++) cap(i);
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, send };
}

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('zl.* list objects', () => {
  it('zl.rev reverses', () => {
    const { outs, send } = build('zl.rev');
    send([1, 2, 3]);
    expect(outs[0]).toEqual([[3, 2, 1]]);
  });

  it('zl.rev on bang uses the stored (right-inlet) list', () => {
    const { outs, send } = build('zl.rev');
    send([4, 5, 6], 1);
    send(bang);
    expect(outs[0]).toEqual([[6, 5, 4]]);
  });

  it('zl.len counts atoms', () => {
    const { outs, send } = build('zl.len');
    send([10, 20, 30, 40]);
    expect(outs[0]).toEqual([[4]]);
  });

  it('zl.sum adds numbers', () => {
    const { outs, send } = build('zl.sum');
    send([1, 2, 3, 4]);
    expect(outs[0]).toEqual([[10]]);
  });

  it('zl.median (odd and even lengths)', () => {
    const odd = build('zl.median');
    odd.send([5, 1, 3]);
    expect(odd.outs[0]).toEqual([[3]]);
    const even = build('zl.median');
    even.send([1, 2, 3, 4]);
    expect(even.outs[0]).toEqual([[2.5]]);
  });

  it('zl.delace splits alternating atoms', () => {
    const { outs, send } = build('zl.delace');
    send([1, 2, 3, 4, 5]);
    expect(outs[0]).toEqual([[1, 3, 5]]);
    expect(outs[1]).toEqual([[2, 4]]);
  });

  it('zl.sort ascending, with index permutation on outlet 1', () => {
    const { outs, send } = build('zl.sort');
    send([30, 10, 20]);
    expect(outs[0]).toEqual([[10, 20, 30]]);
    expect(outs[1]).toEqual([[1, 2, 0]]);
  });

  it('zl.sort descending when order < 0', () => {
    const { outs, send } = build('zl.sort', -1);
    send([1, 3, 2]);
    expect(outs[0]).toEqual([[3, 2, 1]]);
  });

  it('zl.slice splits at N', () => {
    const { outs, send } = build('zl.slice', 2);
    send([1, 2, 3, 4, 5]);
    expect(outs[0]).toEqual([[1, 2]]);
    expect(outs[1]).toEqual([[3, 4, 5]]);
  });

  it('zl.rot rotates rightward by distance', () => {
    const { outs, send } = build('zl.rot', 1);
    send([1, 2, 3, 4]);
    expect(outs[0]).toEqual([[4, 1, 2, 3]]);
  });

  it('zl.nth returns the 1-based element and the remainder', () => {
    const { outs, send } = build('zl.nth', 2);
    send([10, 20, 30]);
    expect(outs[0]).toEqual([[20]]);
    expect(outs[1]).toEqual([[10, 30]]);
  });

  it('zl.group accumulates into fixed-size groups', () => {
    const { outs, send } = build('zl.group', 2);
    send([1]);
    expect(outs[0]).toEqual([]);
    send([2, 3]);
    expect(outs[0]).toEqual([[1, 2]]);
    send([4]);
    expect(outs[0]).toEqual([[1, 2], [3, 4]]);
  });

  it('zl.join appends the stored list', () => {
    const { outs, send } = build('zl.join', 9, 9);
    send([1, 2]);
    expect(outs[0]).toEqual([[1, 2, 9, 9]]);
  });

  it('zl.filter keeps non-matching (outlet 0) and removes matching (outlet 1)', () => {
    const { outs, send } = build('zl.filter', 2, 4);
    send([1, 2, 3, 4, 5]);
    expect(outs[0]).toEqual([[1, 3, 5]]);
    expect(outs[1]).toEqual([[2, 4]]);
  });

  it('zl.compare reports list equality', () => {
    const { outs, send } = build('zl.compare', 1, 2, 3);
    send([1, 2, 3]);
    send([1, 2, 4]);
    expect(outs[0]).toEqual([[1], [0]]);
  });

  it('zl.change suppresses repeats', () => {
    const { outs, send } = build('zl.change');
    send([1, 2]);
    send([1, 2]);
    send([3]);
    expect(outs[0]).toEqual([[1, 2], [3]]);
  });

  it('zl.queue is FIFO', () => {
    const { outs, send } = build('zl.queue');
    send([1, 2, 3]);
    send(bang);
    send(bang);
    expect(outs[0]).toEqual([[1], [2]]);
  });

  it('zl.stack is LIFO', () => {
    const { outs, send } = build('zl.stack');
    send([1, 2, 3]);
    send(bang);
    send(bang);
    expect(outs[0]).toEqual([[3], [2]]);
  });
});

describe('pack / pak / unpack', () => {
  it('pack: left inlet triggers, right inlet stores silently', () => {
    const { outs, send } = build('pack', 0, 0);
    send([7], 1); // store slot 1, no output
    expect(outs[0]).toEqual([]);
    send([3], 0); // slot 0 + trigger
    expect(outs[0]).toEqual([[3, 7]]);
  });

  it('pak: any inlet triggers output', () => {
    const { outs, send } = build('pak', 0, 0);
    send([5], 1);
    expect(outs[0]).toEqual([[0, 5]]);
  });

  it('unpack distributes atoms to their outlets', () => {
    const { outs, send } = build('unpack', 0, 0, 0);
    send([1, 2, 3]);
    expect(outs[0]).toEqual([[1]]);
    expect(outs[1]).toEqual([[2]]);
    expect(outs[2]).toEqual([[3]]);
  });
});

describe('iter / bag / funnel / spray / mean / bucket', () => {
  it('iter emits atoms one at a time', () => {
    const { outs, send } = build('iter');
    send([1, 2, 3]);
    expect(outs[0]).toEqual([[1], [2], [3]]);
  });

  it('bag stores numbers and dumps on bang; 0 at right clears', () => {
    const { outs, send } = build('bag');
    send([1]);
    send([2]);
    send(bang);
    expect(outs[0]).toEqual([[1], [2]]);
    send([0], 1); // clear
    outs[0].length = 0;
    send(bang);
    expect(outs[0]).toEqual([]);
  });

  it('funnel tags a value with its inlet index (+ offset)', () => {
    const { outs, send } = build('funnel', 3, 10);
    send([5], 0);
    send([6], 2);
    expect(outs[0]).toEqual([[10, 5], [12, 6]]);
  });

  it('spray routes [index, value] to the right outlet', () => {
    const { outs, send } = build('spray', 3);
    send([0, 100]);
    send([2, 200]);
    expect(outs[0]).toEqual([[100]]);
    expect(outs[2]).toEqual([[200]]);
  });

  it('mean tracks a running average and count', () => {
    const { outs, send } = build('mean');
    send([2]);
    send([4]);
    expect(outs[0]).toEqual([[2], [3]]); // (2)/1, (2+4)/2
    expect(outs[1]).toEqual([[1], [2]]);
  });

  it('bucket is a shift register (1 stage = one-step delay)', () => {
    const { outs, send } = build('bucket', 1);
    send([5]);
    send([6]);
    send([7]);
    expect(outs[0]).toEqual([[0], [5], [6]]);
  });

  it('thresh accumulates atoms and flushes after the gap', () => {
    vi.useFakeTimers();
    const { outs, send } = build('thresh', 20);
    scheduler.start();
    send([1]);
    send([2, 3]);
    expect(outs[0]).toEqual([]); // nothing yet
    vi.advanceTimersByTime(25);
    expect(outs[0]).toEqual([[1, 2, 3]]);
  });
});
