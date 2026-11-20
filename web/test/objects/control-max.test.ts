// Max-parity tests for histo, bondo, offer, bucket and date: each assertion follows
// the object's Max reference page (refpages/max-ref/<name>.maxref.xml).
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/flow';
import '../../src/objects/control/list';
import '../../src/objects/control/triggers';
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

// Build an object; `log` records every output in firing order as [outlet, msg].
function build(className: string, args: (number | string)[] = [], nOutlets = 4) {
  const node = getFactory(className)!(args, { ctx });
  const log: [number, Msg][] = [];
  for (let i = 0; i < nOutlets; i++) node.onControlOut?.(i, (m) => log.push([i, m]));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, log, send };
}

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('histo (Max)', () => {
  it('left outlet = the number, right outlet = its count, count first', () => {
    const { log, send } = build('histo', [], 2);
    send([5]); send([5]); send([9]);
    expect(log).toEqual([
      [1, [1]], [0, [5]],
      [1, [2]], [0, [5]],
      [1, [1]], [0, [9]],
    ]);
  });

  it('bang reports the last number and its count (0 0 before any input)', () => {
    const { log, send } = build('histo', [], 2);
    send(bang);
    expect(log).toEqual([[1, [0]], [0, [0]]]);
    log.length = 0;
    send([3]); send([3]); send([7]); send([3]);
    log.length = 0;
    send(bang);
    expect(log).toEqual([[1, [3]], [0, [3]]]);
  });

  it('right inlet queries a count without counting it', () => {
    const { log, send } = build('histo', [], 2);
    send([4]);
    log.length = 0;
    send([4], 1); send([4], 1); send([8], 1);
    expect(log).toEqual([[1, [1]], [0, [4]], [1, [1]], [0, [4]], [1, [0]], [0, [8]]]);
  });

  it('ignores numbers outside 0..size-1; clear erases', () => {
    const { log, send } = build('histo', [16], 2);
    send([-1]); send([16]); send([200]);
    expect(log).toEqual([]);
    send([15]);
    send(['clear']);
    log.length = 0;
    send([15]);
    expect(log).toEqual([[1, [1]], [0, [15]]]);
  });
});

describe('bondo (Max)', () => {
  it('a message in ANY inlet sends all stored values, right-to-left (0 until set)', () => {
    const { log, send } = build('bondo', [], 2);
    send([20], 1);
    expect(log).toEqual([[1, [20]], [0, [0]]]);
    log.length = 0;
    send([10], 0);
    expect(log).toEqual([[1, [20]], [0, [10]]]);
    log.length = 0;
    send([30], 1);
    expect(log).toEqual([[1, [30]], [0, [10]]]);
  });

  it('first argument sets the number of inlets/outlets', () => {
    const { node, log, send } = build('bondo', [3], 3);
    expect(node.controlIns?.length).toBe(3);
    send([7], 2);
    expect(log).toEqual([[2, [7]], [1, [0]], [0, [0]]]);
  });

  it('second argument delays output from a message; bang is immediate', () => {
    vi.useFakeTimers();
    const { log, send } = build('bondo', [2, 100], 2);
    scheduler.start();
    send([5], 1);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(log).toEqual([[1, [5]], [0, [0]]]);
    log.length = 0;
    send(bang, 0);
    expect(log).toEqual([[1, [5]], [0, [0]]]);
  });

  it('set stores without output; a list spreads across the inlets', () => {
    const { log, send } = build('bondo', [3], 3);
    send(['set', 9], 1);
    expect(log).toEqual([]);
    send([1, 2], 1);
    expect(log).toEqual([[2, [2]], [1, [1]], [0, [0]]]);
  });

  it('with the n flag a list is stored whole at one inlet', () => {
    const { log, send } = build('bondo', [2, 'n'], 2);
    send([1, 2, 3], 0);
    expect(log).toEqual([[1, [0]], [0, [1, 2, 3]]]);
  });
});

describe('offer (Max)', () => {
  it('stores a pair silently, outputs y once, then the pair is gone', () => {
    const { log, send } = build('offer', [], 1);
    send([64], 1);
    send([0]);         // stores 0 -> 64, no output
    expect(log).toEqual([]);
    send([0]);         // retrieves 64 and deletes the pair
    send([0]);         // nothing left: no output
    expect(log).toEqual([[0, [64]]]);
  });

  it('a list "x y" stores a pair; unknown x does nothing', () => {
    const { log, send } = build('offer', [], 1);
    send([3, 72]);
    send([5]);
    expect(log).toEqual([]);
    send([3]);
    expect(log).toEqual([[0, [72]]]);
  });

  it('bang outputs every stored y; clear deletes all', () => {
    const { log, send } = build('offer', [], 1);
    send([1, 60]); send([2, 67]);
    send(bang);
    expect(log).toEqual([[0, [60]], [0, [67]]]);
    log.length = 0;
    send(['clear']);
    send([1]);
    send(bang);
    expect(log).toEqual([]);
  });
});

describe('bucket (Max)', () => {
  it('N outlets: a number sends the stored values (right-to-left), then shifts', () => {
    const { log, send } = build('bucket', [3], 3);
    send([1]);
    expect(log).toEqual([[2, [0]], [1, [0]], [0, [0]]]);
    log.length = 0;
    send([2]);
    expect(log).toEqual([[2, [0]], [1, [0]], [0, [1]]]);
    log.length = 0;
    send([3]);
    expect(log).toEqual([[2, [0]], [1, [1]], [0, [2]]]);
    log.length = 0;
    send([4]);
    expect(log).toEqual([[2, [1]], [1, [2]], [0, [3]]]);
  });

  it('echo mode (non-zero 2nd arg) sends the new number out the left outlet at once', () => {
    const { log, send } = build('bucket', [3, 1], 3);
    send([1]); send([2]);
    expect(log.slice(3)).toEqual([[2, [0]], [1, [1]], [0, [2]]]);
  });

  it('bang outputs without shifting; set fills every stage', () => {
    const { log, send } = build('bucket', [2], 2);
    send([5]);
    log.length = 0;
    send(bang); send(bang);
    expect(log).toEqual([[1, [0]], [0, [5]], [1, [0]], [0, [5]]]);
    log.length = 0;
    send(['set', 9]);
    expect(log).toEqual([[1, [9]], [0, [9]]]);
  });

  it('r2l stores new numbers at the right; l2r restores', () => {
    const { log, send } = build('bucket', [3], 3);
    send(['r2l']);
    send([1]); send([2]);
    log.length = 0;
    send(bang);
    expect(log).toEqual([[2, [2]], [1, [1]], [0, [0]]]);
    send(['l2r']);
    send([3]);
    log.length = 0;
    send(bang);
    expect(log).toEqual([[2, [1]], [1, [0]], [0, [3]]]);
  });

  it('freeze suspends output while values still shift; thaw resumes; clear is silent', () => {
    const { log, send } = build('bucket', [2], 2);
    send(['freeze']);
    send([1]); send([2]);
    expect(log).toEqual([]);
    send(['thaw']);
    send(bang);
    expect(log).toEqual([[1, [1]], [0, [2]]]);
    log.length = 0;
    send(['clear']);
    expect(log).toEqual([]);
    send(bang);
    expect(log).toEqual([[1, [0]], [0, [0]]]);
  });

  it('roll feeds the last stage back into the first', () => {
    const { log, send } = build('bucket', [3], 3);
    send([1]); send([2]); send([3]); // stages: 3 2 1
    log.length = 0;
    send(['roll']);                 // outputs 3 2 1, then stages: 1 3 2
    send(bang);
    expect(log.slice(3)).toEqual([[2, [2]], [1, [3]], [0, [1]]]);
  });
});

describe('date (Max)', () => {
  it('date -> outlet 0 as month day year; time -> outlet 1 as hour minute second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 2, 14, 5, 9)); // 2 Aug 2026, 14:05:09
    const { log, send } = build('date', [], 3);
    send(['date']);
    send(['time']);
    expect(log).toEqual([[0, [8, 2, 2026]], [1, [14, 5, 9]]]);
  });

  it('ticks -> outlet 2 as a whole number of 1/60 s; bang does nothing', () => {
    const { log, send } = build('date', [], 3);
    send(bang);
    expect(log).toEqual([]);
    send(['ticks']);
    expect(log.length).toBe(1);
    expect(log[0][0]).toBe(2);
    expect(Number.isInteger(log[0][1][0])).toBe(true);
  });
});
